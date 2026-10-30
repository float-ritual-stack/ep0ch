import { expandsEmbeds } from "../embed-policy";
import { standsAsPerson } from "./dispatch";
import { READER_MOVE_KEYS, ZOOM_KEYS, SOURCES_KEYS, SOURCE_KEYS, SOURCE_FIELD_KEYS, REPLIES_KEYS, REPLIES_FOLD_KEYS, REPLIES_CONTROLS, REVISION_KEYS, REVISION_CONTROLS, COMMENT_KEYS, EDIT_PREVIEW_KEYS, EDIT_PREVIEW_READER_KEYS, ATTACHED_KEYS } from "./attached-keys";
import { modeBinding, modeHint, modeActionKeys } from "./modes";
import { hintSetting } from "./hints";
import { fullPlainText, selectFullText } from "../overflow";
import { commandButton } from "../bar/command";
import { buttonRows, buttonText, pressing, pressState } from "./button";
import { withFigureProp } from "@ep0ch/outline-core/figure-props";
import { checkValue as schemaCheck } from "@ep0ch/outline-core/component-schema";
import { Inspector } from "./inspector";
import { coerceActionArgs } from "./actions";
import { errorDetails } from "../status-log";
import { messageContext } from "../status-log";
import { mentionsExtension as mentionsExtensionLine, mentionsStamp } from "../extensions";
import { Canvas, LINE_BOX, stringFrame } from "../canvas";
import { CONFIRM_HINT, hintStatus } from "./hint-card";
import { heroLook } from "./hero-look";
import { withFigureBoard } from "../graphs";
import { outlineBoards, readNote, type NoteAddress } from "../desk/outline-boards";
import { subtitleOf } from "@ep0ch/outline-core/block-record";
import { HEADER_VALUES } from "@ep0ch/outline-core/component-schemas-blocks";
import { headerLine } from "@ep0ch/outline-core/header-line";
import { InlineList, inlineRowKey } from "./inline-list";
import { LISTVIEW_ACTIONS, listNamed, type ListHost } from "./list-actions";
import { ListView, listRowLines, listRowsOf, PERSON, selectable, type ListHandle, type ListViewRow } from "./list-view";
import { activationOf, type ListPrimitive } from "@ep0ch/outline-core/list-row";
import { type ArtifactInfo } from "@ep0ch/outline-core/artifacts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { outlineState } from "../state";
import { sourceDownload } from "@ep0ch/outline-core/sources";
import { ReaderPosition, PositionRows } from "../reader-position";
import { NoteForm, FORM_KEYS, FORM_CHOICE_KEYS } from "./note-form";
import { elementEdit, type ElementOperation } from "./element-editor";
// The note surface: one note, shown, edited and commented on the same way wherever it is hosted — the
// board's preview, details and floats, the desk's reader, and (next) a river column. It owns the note's
// rendering, links, the edit control (a Draft, with Ctrl+E handing it to $EDITOR), passage selection
// and comment threads, the property warning, "changed elsewhere", and keeping unsaved text safe.
//
// A host gives it a rectangle of any width and a SurfaceHost (the door's context, a redraw, and where
// a followed link opens). Everything a person can do here is also a named action (NOTE_ACTIONS), so an
// agent driving the door through its control socket goes through the same code as the keys.
import { savedReferenceWarning } from "../reference-warnings";
import { revisionByline } from "@ep0ch/outline-core/attribution";
import { componentBlocks } from "@ep0ch/outline-core/component-block";
import { componentRowFields, listFieldsTuned, listTarget, lookFor, pageOf as lookPage, type Look } from "../look";
import { fencedLines, LIST_ITEM, listLayers, listStart, type StyleLayer } from "@ep0ch/outline-core/style-cascade";
import { onlyScrolled, overscrollRows, scrolled, wheelRows } from "../scroll";
import type { Ctx } from "../app";
import { headedTitle, subject, titleLine, type Msg } from "../board";
import { editArmMs } from "../arm";
import { codeFenceLines } from "@ep0ch/outline-core/code-fence";
import { literalLines } from "@ep0ch/outline-core/code-ranges";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { syntaxWarnings } from "@ep0ch/outline-core/syntax-warnings";
import { propertyTokensInLine, splitPropertyValue } from "@ep0ch/outline-core/property-grammar";
import { fragmentAnchorMatch, linkOccurrences, referencedBlock, withoutFragmentAnchor, type LinkOccurrence } from "@ep0ch/outline-core/link-syntax";
import { landingLine } from "@ep0ch/outline-core/block-insert";
import { CommentSession, editedMark, type CommentEnv } from "../comment";
import type { Step } from "../session/restore";
import { childEnv, codeSpans, foldPoints, heroBox, mediaLines, mediaRows, renderDoc, type Doc, type DocBlock, type DocEnv, type DocImage, type FoldPoint, type ImageControl } from "../doc";
import { DENSITIES, isDensity, type Density, type FigureControl, type FigureInfo } from "../graphs";
import { embedRegion, embedsLoading, embedState, viewResults, embedStepChanged, isOpenProposal, proposalsBeside, NOT_APPLICABLE, proposalApplies, proposalControls, proposalOps, SHADE, type EmbedBody } from "../embeds";
import { findOutputRegions } from "@ep0ch/outline-core/output-region";
import { sourceCalls, withSlotProps, type SourceEntry } from "@ep0ch/outline-core/sources";
import { drawSources, FOLDS, itemsOf, newPanel, sourceAt, type PanelDraw, type SourcesFold, type SourcesPanel } from "./sources";
import { joinRows, REGION_MARK, type RegionBook } from "../output-region";
import { decorationsOf, drawingPending, drawnPresses, extensionRegion, mayHaveProjections, projectionRegion, projectionsLoaded, projectionsOf, regionsByLine, resourceChanged, RUN_AGAIN, RUN_AGAIN_KEY, ticketBlocksOf, ticketRegion, type ResourceProjection, type TicketPart } from "../projection";
import { decorationRows, planDecorations } from "../decorations";
import { EXT_ACTIONS, EXT_UNDO, extensionNamed, handlerKeyAction } from "../extensions";
import { blockTags } from "@ep0ch/outline-core/block-tags";
import { metadataLines, printable, setUserSummaryKeys, summaryKeys, summarySegments, tokensFor, tokensOf, type Source, prop, propValues } from "../props";
import { type CalloutRef, type ImageRef, type SiteCall, LINK_OFF, LINK_ON, outlineChanged, pageView, pageOf, presentLinks, commentSubject, resourceTokensOf, refKey, referencesIn, refView, siteAnswerOf, siteAnswerWaiting, workIdPrefix, shortId, type LinkTarget } from "../refs";
import { EMPTY_VALUE, MAX_NOTE_VALUES, hasWords, pairValues, problemWords, readerWords, valueWords } from "@ep0ch/outline-core/site-values";
import { workIdTitle } from "@ep0ch/outline-core/work-id-title";
import { alignComments, isOutlineNote, onTheirWords, openResource, RESOURCE_NOTE, rereadResource, resourceRefTarget, resourceTarget, UNSENT_NOTE } from "../authored";
import { isResourceRef } from "@ep0ch/outline-core/resource-ref";
import { changeOf, liveRowStep, parseStatus, STEP_BOXES, STEP_CHOICES, STEP_MARKS, stepChanged, UndoHistory, stepLink, stepsLoading, stepsOf, stepStillOn, stepTitle, statusWord, partyOf, type StepChoice, type StepRef } from "../steps";
import { boxStatus, stepClosed } from "@ep0ch/outline-core/checklist-marks";
import { addressedResource, destinationOf, external, externalOpenCommand, fileOpenCommand, opensRemotely, openRemote } from "../open";
import { Draft, DRAFT_ACTIONS, sameParty, tidy, whenPut, type DraftActionArgs } from "../edit";
import { agentRefusal, blockTarget, noteReplyTarget, recordAs, DraftSession, hasStrays, keepUnsent, leaveSaid, propertyChange, propertyListOf, takeStrays, unsent, unshelve, unshelveIf, type Ended, type LeaveResult, type Unsent } from "../draft-session";
import { pageWithResults } from "../page-results";
import { baseTextOf, copyNote, copyOf, diffNote, oldUnsentLine, settleQuietly, unsentEntries, unsentLabel, unsentView, viewVerdict, type UnsentEntry, type UnsentKind, type UnsentOp } from "../unsent";
import { compareDraft, dayOf, hunksOf, linesOf, verdictWords } from "../unsent-compare";
import { inWindow, type Placement } from "../kitty";
import { theme, type Rgb } from "../theme";
import { ALIGNS, fileName, HERO_PROP_NAMES, HERO_PROPS, heroPropSet, heroPropStep, heroPropText, imagePrimitiveSpec, isHeroProp, media, type HeroProp, parseDim, parseFocus, parseMediaLine, parseSize, rewriteMediaLine, sized, sizeText, type Focus, type ImagePrimitive, type MediaAttr, type MediaSpec } from "../media";
import { artifactFacts } from "../artifacts";
import { backdrop, heroHeaderMode, heroHeaderOn, heroStep, HERO_RAMP_ROWS, HERO_STEPS, overColours, type CellGrid, type HeroMode } from "./hero-header";
import { TONE_INDEX, surfaceMix } from "../theme";
import type { Scroll } from "../canvas";
import type { PropertyRecord } from "@ep0ch/outline-core/property-parse";
import { authorName, whoOf, changedSinceRead, EditConflict, mutationFor, Offline, recorded, recordedActorId, Refused, USER, type Actor, type ChecklistStep, type Comment, type CommentPassage, type OutlineEvent, type PropertyPatch, type QuotePlace, type QuoteReceipt, type QuoteSubject } from "../socket";
import { lastTrashed } from "../note-trash";
import { blockRefText, embedOccurrences } from "@ep0ch/outline-core/link-syntax";
import { BUTTON_GROUP, deliverNoteRef, noteRefText, type NoteRefKind } from "../note-ref";
import { markReveal, revealOn } from "../reveal";
import { drawRevision, openingRow, revisionFacts, type RevisionAgainst, type RevisionView } from "./revision-compare";
import { revisionDiff } from "../desk/what-changed";
import { liveMarkValue, liveRowStatus } from "@ep0ch/outline-core/figure-live";
import { fieldsBlocksOf } from "@ep0ch/outline-core/site-blocks";
import { fieldsDrawn, type FieldsDrawing } from "../site-blocks";
import { visible, headOf, tailFrom, BOLD, bgRgb, fgRgb, ellipsize, drawEllipsized, dim, C, extractLinks, fg, LINK_END, linkTag, pad, RESET, stripMarks, stripTags, width, type LinkRange } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { ago, bbsDate, rowLines, rule, wrap } from "../text";
import { startShare, endsIn } from "../share-cli";
import type { FragmentKind, ShareSession } from "@ep0ch/outline-core/protocol";
import { startsTable, tableCells } from "@ep0ch/outline-core/table-shape";
import { ActionRefused, actionSet, boundNow, def, keyCaption, agentLabel, agentWords, asActor, type ActionDef, type ActionSet, type ArgsOf, type ArgsOfSet, type MenuEntry, type MenuNow } from "./actions";
import { Dispatcher } from "./dispatch";
import { holdsEdit, NOBODY } from "../whereabouts";
import { draftState, editHint, editorClick, openInEditor, renderEditor, previewRows, wheelTarget, writtenBy, type EditFrame } from "./editor";
import { composerBody, composerBox, placeBox, type ComposerBox } from "./composer";
import { AttachedTile, attachedAt, attachedPlaceOf, attachedRect, drawAttachedFloat, type AttachedTileHost, type AttachedSide, type AttachedPlace, type AttachedSplit, type FloatMove, moveFloat, ATTACHED_PLACES, frameZone, nextPlace, SPLIT_MIN_H, SPLIT_MIN_W, type FloatRect } from "./attached";
import { pickerCwd, pickInto, type Picked } from "../pick";
import { sourceSpanOf } from "./source-map";
import { askingFirst, extensionList, passageActions, runExtensionAction, scriptActions, installWords, threadAgents } from "../extensions";
import { actionLine, actRequestOf, lineWords } from "@ep0ch/outline-core/action-line";
import { INVITES } from "./invite";
import { buttonCallAt, buttonCallsOf, slotArgs, withButtonSlot, type ButtonCall } from "@ep0ch/outline-core/button-call";
import { componentsOf, componentsReady } from "../component-schemas";
import { NODELIST_QUERY, nodesOf } from "../echonet/net";
import type { ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { SettingsCard, settingFields, settingProblem, settingQuestion, settingsSchemas, settingValue, type SettingField, type SettingSources } from "./settings-card";
import { askInBar } from "../bar/ask";
import { argQuestion } from "../bar/form";
import type { ActionInfo } from "./actions";
import { parseTileAddress } from "../desk/tile-address";
import { buttonLineLook, buttonMarks, describeButtonMarks, type ButtonLookups } from "../button-check";
import { useRegion, type UseSite } from "../template-use";
import { propQuestion } from "../template-stamp";
import { useCallsOf, withUseProps } from "@ep0ch/outline-core/template-use";
import type { LiveSite } from "../live";
import { SocketBoard } from "../socket";
import { intentOf, moveNote, moveQuestion, MOVE_UNDO, routeNote, undoMove, type MoveArgs } from "../note-move";
import { cardBg, hasCard, kindOf, MARGIN_MODE_WORDS, MARGIN_MODES, MARGIN_RESERVE, marginColumn, nextMargin, onCard, placeCards, spanBg, toneBg, toolbarRow, type MarginMode, type PassageChoice } from "./margin";
import { findPassage, isMiss, missMessage, passageAt, type Passage as PassageTarget } from "@ep0ch/outline-core/passage";
import { annotationKind, annotationTone, type MarkLifecycle } from "@ep0ch/outline-core/annotation-marks";
import { hostname } from "node:os";
import { clipboardImage, droppedImage, imageLine, imagePathAt, keepImage, noClipboardImage } from "../paste-image";
import { COMPLETION_ACTIONS, COMPLETION_PREVIEW, COMPLETION_STEP, COMPLETION_COPY, COMPLETION_DEFINITION, COMPLETION_MOVE, COMPLETION_ACCEPT, COMPLETION_ASK, COMPLETION_DISMISS, COMPLETION_ROWS, completerFor, completerOf, completionOf, insertCompletion, lookupCompletion, nearOf, reopenReference, actionHereAt, type CompletionBoard, type Completer } from "./completer";
import { completionTargetAtCursor, type CompletionTarget } from "@ep0ch/outline-core/completion-triggers";
import { checkValue, propertyRows, PropertyPanel, valueTarget, valueView, type PropRow, type ValueRow } from "./props-panel";
import { ModeStack, type ReaderMode } from "./modes";
import { filterLine, LineField } from "./line";
import { isAnnotationBlock, readReplies, readThread, threadRows, type ThreadData, linkRows, SEP, linkRowLines, linkTargetOf, describeLinkRow, type LinkData, type LinkGroupName, type LinkRow, type LinkBlocksEnv } from "../links";
import { DEFAULT_BACKLINK_VIEW_OPTIONS } from "../backlinks";
import { MOUSE_ALT, RowPresses } from "../scroll";
import { readState, writeState } from "../state";
import { menuRow } from "../desk/tile-menu";
import { centred, ListPicker, pickRow } from "./picker";
import { calloutProblems, calloutsOf, calloutsStamp, TONE } from "../callouts";
import { headingStylesOf, headingStylesStamp } from "../heading-styles";
import { calloutBlocks, rewriteCalloutHeader, stripQuotes, type CalloutRegistry } from "@ep0ch/outline-core/callouts";
import { AGENT_BG, selectText, cellsOf, copyOnSelect, Gesture, isCopyKey, lineAt, modeKey, paintRange, ITEM_BG, ITEM_IDLE_BG, putCell, RULER_BG, RULER_IDLE_BG, readingRuler, SELECT_BG, Selection, selectionHint, THREAD_BG, wordAt, ZEBRA_BG, type Pos, type SelectRows } from "./selection";

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
export interface OpenHow { link?: boolean; fresh?: boolean; by?: Actor; standing?: boolean }
/**
 * A link that names something outside the door: a web page (`browser`) or a file (`viewer`, a figure). The person's
 * follow opens it there; an agent's never does (`launched: false`): it is given the address instead.
 */
export interface Outside { outside: "browser" | "viewer"; url: string; launched: boolean }
/** A reader opened a query (a #tag or an activity day): its list and matching notes. */
export interface TagList { tag?: string; query: string; tile?: string; notes: { id: string; title: string }[] }

/** What a surface needs from whatever hosts it. */
export interface SurfaceHost {
  /** A history landing uses the host's usual note placement. */
  historyLanded?(by: Actor): void;
  /** A list over the screen this reader is on (the desk's overlays): the trail (PIE-208) opens in it. */
  overlay?(p: ListPicker<any, any>): void;
  contextFor?(note: Msg | null): Ctx;
  ctx: Ctx;
  /** The screen this reader is on (its desk): what an edit's actions here are listed for (PIE-1439). */
  screen?(): import("../app").Screen | undefined;
  redraw(): void;
  /**
   * The look (PIE-673) the host resolved for where this reader is (its tile kind, its screen, the note): its margin,
   * gap and list rows. Without one, the reader resolves the note's own (global and page levels) itself.
   */
  readonly look?: Look;
  /** The tile host draws the gutter outside its padded, measured content rectangle. */
  readonly externalGutter?: number;
  readonly innerFrame?: FloatRect;
  readonly heroBounds?: { col: number; row: number; cols: number };
  /** A followed link or `u` (up): the host decides where the note opens (in place, or where its wires say). */
  navigate(m: Msg, how?: OpenHow): void;
  /**
   * The click being handled is an alt-, ctrl- or middle-click, which the host opens fresh (its `navigate` for this
   * click opens a new detail): a list's row opens at once rather than being selected (an inline `::links`, PIE-693).
   */
  freshClick?: boolean;
  /** A host's navigation rows (such as earlier briefs) open on the first click. */
  opensOnClick?(link: Link): boolean;
  /** Detach the part this reader is on into a tile of its own (`element.detach`, alt+D, PIE-1247); absent where the reader isn't a tile. */
  detach?(): void;
  /** Show this reader's note in the outline (`reader.reveal`, a click on the crumbs, PIE-794); absent where there's no outline to show it in. */
  revealInOutline?(): void;
  /**
   * A `#tag` was opened in the note (PIE-800): the host lists the notes carrying it (the service's `#tag` query), as a
   * list whose home is this reader. `how.by` is who opened it.
   */
  tag?(tag: string, how?: OpenHow): Promise<TagList>;
  query?(query: string, how?: OpenHow): Promise<TagList>;
  /** The click being handled gave this reader the keys: a list's row is only selected by it (PIE-794), as in a links tile. */
  focusing?: boolean;
  /**
   * The person's selection in a list drawn in the note (an inline `::links` row) moved to `m`: the host shows it where
   * this reader's selection goes (a preview following it, its preview link), without moving anything else (PIE-794).
   */
  preview?(m: Msg): void;
  /** The summary keys of the view this note is shown from (a lane's `[summary-properties::…]`), if any. */
  summaryKeys?(m: Msg): readonly string[] | null | undefined;
  /**
   * Start a session as the person's key does, where the host keeps track of which session the person is in: the
   * thread list (⏎ or a click on a comment mark), an armed edit confirmed (edit.arm). Without it the surface opens it itself.
   */
  startSession?(kind: SessionKind, opener?: Key): void | Promise<unknown>;
  /** The person's new note `m` made from this reader, opened in their edit where their new notes open (`note.opens`), lit as arrived. */
  writeNew?(m: Msg): Promise<{ tile: string; surface: NoteSurface } | null>;
  /**
   * The comment being written goes into a tile of its own beside this reader (`on`), or out of it (PIE-846): the host's
   * `comment` tile, which moves, sizes and docks as tiles do. Hosts with no tiles (the BBS reader, a river column) have
   * none: a comment there is drawn split.
   */
  answerTile?(ask: string, actor: Actor, fold?: string): Promise<unknown>;
  /** Pointer coordinates belong to this attached tile rather than the note beneath its floats. */
  attachment?: "comment" | "sources" | "list-preview" | "edit-preview";
  hasWiredPreview?(): boolean;
  hasListPreviewTile?(): boolean;
  listPreviewTile?(on: boolean, side?: AttachedSide): Promise<unknown>;
  hasEditPreviewTile?(): boolean;
  editPreviewTile?(on: boolean, side?: AttachedSide): Promise<unknown>;
  hasSourcesTile?(): boolean;
  sourcesTile?(on: boolean, side?: "left" | "right" | "up" | "down"): Promise<unknown>;
  /** Its trail (PIE-208) in a tile of its own beside it (PIE-1425), where the screen has tiles; null when the layout can't place one. */
  trailTile?(): Promise<unknown>;
  composerTile?(on: boolean, keys?: boolean, side?: "left" | "right" | "up" | "down"): Promise<unknown>;
  /** The comment's own tile is open now (composerTile's): false once it was closed by hand. */
  hasComposerTile?(): boolean;
  /**
   * A view's own header rows for the note (the BBS message header: Date, To, From, Subj, Conf), drawn in
   * place of the surface's title, byline and crumb rows. The summary line, notices, an agent's line, a
   * focus mark and the property panel still follow it, and clicks and `[ ]` count its rows.
   */
  header?(m: Msg, w: number, info: HeaderInfo): string[];
  /** The tile's own header (PIE-1248, `tile.header`), over the note's `[header::…]`; absent: the note decides. */
  readonly tileHeader?: TileHeader;
  /** A title written on the tile (`tile.title`), shown in the header in place of the note's; absent: the note's. */
  readonly tileTitle?: string;
  /**
   * A view's own rows after the note's body (EchoNet's FidoNet footer: the tear line, the origin, SEEN-BY): read and
   * scrolled with the note, never its elements.
   */
  footer?(m: Msg, w: number): string[];
  /**
   * Back and forward kept by the view instead of the surface (PIE-453), where a followed link doesn't open in
   * this reader: the BBS reader's screen stack, the river's columns. Without it the surface keeps its own.
   */
  history?: ReaderHistory;
  /** What this reader keeps with its layout changed (its back and forward stacks, PIE-643; its margin, PIE-873): the host saves it. */
  keptChanged?(): void;
  /**
   * The note shown went to the trash (an empty new note, PIE-544) and this reader had nowhere back to go: a screen
   * that was opened for it alone closes. Without it the reader stays on it.
   */
  gone?(id: string): void;
  /** This is the reader the person has focused (for the reader on its own, `NoteSurface.alone`); false: it isn't. */
  focused?: boolean;
  /**
   * The person is in this reader's edit, comment or panel: their keys type into it (the desk's entered session). False:
   * one open here is left as it was (PIE-812), drawn away. Undefined: the host doesn't say (a reader on its own).
   */
  entered?: boolean;
  enterMode?(): void;
  /** Whose action runs through this host: an agent's (NoteSurface.run sets it), else the person's. */
  actor?: Actor;
  /**
   * A note action in this reader as the person (its keys and clicks), through the host's dispatcher, where the
   * reader is a tile (PIE-514); `quiet`: the action says its own refusal. Without it the reader's own dispatcher runs it.
   */
  press?(name: string, args: Record<string, unknown>, quiet?: boolean | ((why: string) => string | null), host?: SurfaceHost): Promise<unknown>;
  /** The same press for an action of another set on this reader's tile (the lists' actions, PIE-747). */
  pressSet?(set: ActionSet<any, any>, name: string, args: Record<string, unknown>, quiet?: boolean | ((why: string) => string | null), host?: SurfaceHost): Promise<unknown>;
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
  /** The place in the door's undo order of the screen's newest layout change (PIE-957): a reader's ctrl+z yields to it only when the reader has nothing of its own to undo (PIE-1435). */
  layoutUndoSeq?(): number | undefined;
  /**
   * Bring back the note the person trashed last on `board` (the desk's note.untrash): a reader's ctrl+z, when that trash is
   * newer than its own change. False when the desk can't: a reader on another outline's board.
   */
  untrash?(board: object): boolean;
  /**
   * This note's links (Outlinks, Resources, Backlinks) in the screen's links tile, as `b` asks: where the host has
   * one, or can open one beside the reader. Without it `b` says so and points at the inline `::links`.
   */
  conference?: boolean;
  links?(actor: Actor, standing: boolean): Promise<Record<string, unknown>>;
}

/** Back and forward where a view keeps them (SurfaceHost.history). */
export interface ReaderHistory {
  /** The title back (-1) or forward (1) goes to, or null when there's nowhere to go. */
  peek(dir: -1 | 1): string | null;
  /** Go there, `steps` stops at once (default 1): null when it went, else why not. */
  go(dir: -1 | 1, actor: Actor, steps?: number): string | null | Promise<string | null>;
  /** Every stop back and forward, nearest first (the trail, PIE-208): the same trail `go` walks, read, never a copy. */
  trail?(): { back: TrailStop[]; forward: TrailStop[] };
  /** Why an agent can't go back or forward here: it would move the person's screen or focus. */
  agentRefusal: string;
}

/**
 * Where a reader was (PIE-453), so back comes back to it as it was: the note, how far down, the `[ ]`
 * position (the current element and link), and the reading state kept per note (folds, expanded threads).
 */
interface Place { msg: Msg; position: ReaderPosition; cur: string | null; link: number; folded: string[]; previewLists: [string, boolean][]; previewOpen: string[]; expanded: string[]; foldedThreads: string[]; seen: string[]; figures: [string, FigureChoice][]; zoom?: Zoom | null }
/**
 * The part of its note a reader is zoomed into (PIE-780): the lines the service says it covers (`fragments.at`, the part
 * element.detach takes), its anchor when it has one, and the revision they were read at. Reading state, never the note's.
 */
export interface Zoom { start: number; end: number; line: number; kind: FragmentKind; label: string; anchor?: string; revision: number; head?: string }
/** What the person (or an agent) chose for one live figure in a reader: its tab, its density. Never the note's text. */
type FigureChoice = { tab?: string; density?: Density };
/** How many places back (and forward) a reader keeps. */
export const HISTORY = 50;

/**
 * A reader's place and history as a layout file keeps them (PIE-643). `v` is this shape's version: a file of another
 * version (an older daemon's, a newer one's) is read as having no history, never half-read.
 */
export const NAV_VERSION = 2;
export interface SavedPlace { address?: NoteAddress; id: string; title: string; position: ReaderPosition; cur: string | null; link: number; folded: string[]; previewLists?: [string, boolean][]; previewOpen?: string[]; expanded: string[]; foldedThreads: string[]; seen: string[]; figures: [string, FigureChoice][]; zoom?: Zoom }
export interface SavedNav { v: typeof NAV_VERSION; here?: SavedPlace; backs: SavedPlace[]; aheads: SavedPlace[] }

const savedPlace = (p: Place): SavedPlace => ({ ...(p.msg.address ? { address: p.msg.address } : {}), id: p.msg.id, title: subject(p.msg), position: structuredClone(p.position), cur: p.cur, link: p.link, folded: p.folded, previewLists: p.previewLists, previewOpen: p.previewOpen, expanded: p.expanded, foldedThreads: p.foldedThreads, seen: p.seen, figures: p.figures, ...(p.zoom ? { zoom: p.zoom } : {}) });
/** A saved place as a stub the reader reads whole when it goes there (a list row's shape: `partial`). */
const placeOf = (s: SavedPlace): Place => ({
  msg: { ...(s.address ? { address: s.address } : {}), id: s.id, text: s.title, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: null, properties: [], partial: true },
  position: structuredClone(s.position), cur: s.cur, link: s.link, folded: s.folded, previewLists: s.previewLists ?? [], previewOpen: s.previewOpen ?? [], expanded: s.expanded, foldedThreads: s.foldedThreads, seen: s.seen, figures: s.figures, zoom: s.zoom ?? null,
});
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
/**
 * A sequence's first step when it is an action (its refusal now is exact: nothing has run before it), else null: a script
 * first, or a slot still to fill, can change what the later steps find.
 */
function sequenceStart(call: ButtonCall): string | null {
  const first = call.steps[0];
  return call.sequence && first?.kind === "act" && !first.source.includes("{") ? first.source : null;
}

function readPlace(x: any): SavedPlace | null {
  if (!x || typeof x.id !== "string" || !x.id || typeof x.title !== "string") return null;
  const int = (n: unknown, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.max(d < 0 ? -1 : 0, Math.floor(n)) : d);
  const figures = (Array.isArray(x.figures) ? x.figures : []).filter((f: unknown): f is [string, FigureChoice] => Array.isArray(f) && typeof f[0] === "string" && !!f[1] && typeof f[1] === "object");
  if (x.previewLists !== undefined && (!Array.isArray(x.previewLists) || !x.previewLists.every((p: unknown) => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "boolean")) || x.previewOpen !== undefined && !Array.isArray(x.previewOpen)) return null;
  const p = x.position;
  if (!p || !p.cursor || (p.view !== null && (!p.view || !Number.isFinite(p.view.line) || !Number.isFinite(p.view.row)))) return null;
  const position: ReaderPosition = { reading: int(p.reading, 0), cursor: { row: int(p.cursor.row, 0), col: int(p.cursor.col, 0) }, view: p.view === null ? null : { line: int(p.view.line, 0), row: Math.floor(p.view.row) } };
  return { ...(x.address && typeof x.address.outline === "string" && (x.address.machine === undefined || typeof x.address.machine === "string") ? { address: x.address } : {}), id: x.id, title: x.title, position, cur: typeof x.cur === "string" ? x.cur : null, link: int(x.link, -1), folded: strings(x.folded), previewLists: x.previewLists ?? [], previewOpen: strings(x.previewOpen), expanded: strings(x.expanded), foldedThreads: strings(x.foldedThreads), seen: strings(x.seen), figures, ...(readZoom(x.zoom) ? { zoom: readZoom(x.zoom)! } : {}) };
}
/** A saved zoom (PIE-780), or null for anything that isn't one: it's left out, never half-read. */
function readZoom(z: any): Zoom | null {
  const n = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
  return z && n(z.start) && n(z.end) && n(z.line) && n(z.revision) && z.end >= z.start && typeof z.kind === "string" && typeof z.label === "string" && (z.anchor === undefined || typeof z.anchor === "string") && (z.head === undefined || typeof z.head === "string") ? z : null;
}
/** The note a saved history was taken on, if it is one this version reads. */
export const navNote = (raw: unknown): string | null => readNav(raw)?.here?.id ?? null;
/** A saved history as this version reads it: null for another version or anything that isn't one. */
function readNav(raw: unknown): SavedNav | null {
  const x = raw as any;
  if (!x || typeof x !== "object" || x.v !== NAV_VERSION) return null;
  const list = (l: unknown) => (Array.isArray(l) ? l.map(readPlace).filter((p): p is SavedPlace => !!p).slice(-HISTORY) : []);
  const here = readPlace(x.here);
  return { v: NAV_VERSION, ...(here ? { here } : {}), backs: list(x.backs), aheads: list(x.aheads) };
}

/**
 * A fragment link just followed (PIE-425), kept on the note object that follow handed its host: whichever
 * reader the host shows that object in (in place, a detail, a new column) reveals the fragment, once. It's
 * scoped to that navigation: another show of the same note (a refresh, another follow) is a different object.
 * `by`: whose follow it was; an agent's never scrolls or marks the reader the person has focused.
 */

/**
 * A reader's history keys (PIE-453): alt+←, backspace or the mouse's back button go back; alt+→ or its forward
 * button go forward. alt+b and alt+f too: some macOS terminals send them for option+← and option+→.
 */
/** The trail's key (PIE-208): alt+T, beside back's alt+← and forward's alt+→. */
export const isTrailKey = (k: Key) => k.kind === "alt" && k.ch === "T";

export function historyKey(k: Key): -1 | 1 | 0 {
  if (k.kind === "alt-left" || k.kind === "backspace" || k.kind === "back" || (k.kind === "alt" && k.ch === "b")) return -1;
  if (k.kind === "alt-right" || k.kind === "forward" || (k.kind === "alt" && k.ch === "f")) return 1;
  return 0;
}

/**
 * The history row a reader draws last while it has somewhere to go (PIE-453): `← back · <title>` on the left,
 * `<title> · forward →` on the right, each a click (`hits`, in the row's cells). Null with nowhere to go.
 */
export function historyRow(w: number, back: string | null, forward: string | null, trail = true): { line: string; hits: { from: number; to: number; dir: TrailDir }[] } | null {
  if ((!back && !forward) || w < 8) return null;
  // The trail's chip (PIE-208) after back, where the row has room for it beside both titles.
  const chip = trail && w >= TRAIL_CHIP_MIN ? TRAIL_CHIP : "", chipW = chip ? width(chip) + 2 : 0;
  const room = back && forward ? Math.floor((w - 3 - chipW) / 2) : w - 2 - chipW;
  // Narrow (a preview at 40 columns, PIE-1426): the title goes before the words do, and the words before the arrow,
  // so the row always says which way each click goes, never "← ba…".
  const side = (word: string, title: string, arrow: string, before: boolean) => {
    if (room >= width(word) + 6) {
      const t = `${fg(C.dark)}${drawEllipsized(printable(title), room - width(word) - 3)}`;
      return before ? `${fg(C.lcyan)}${word}${fg(C.dark)} · ${t}` : `${t}${fg(C.dark)} · ${fg(C.lcyan)}${word}`;
    }
    return `${fg(C.lcyan)}${room >= width(word) ? word : arrow}`;
  };
  const b = back ? side("← back", back, "←", true) : "", f = forward ? side("forward →", forward, "→", false) : "";
  const hits: { from: number; to: number; dir: TrailDir }[] = [];
  let line = "", at = 0;
  if (b) { line += " " + b + RESET; hits.push({ from: 0, to: 1 + width(b), dir: -1 }); at = 1 + width(b); }
  if (chip) {
    const from = at + (b ? 2 : 1);
    line += " ".repeat(from - at) + fg(C.lcyan) + chip + RESET;
    hits.push({ from, to: from + width(chip), dir: 0 });
    at = from + width(chip);
  }
  if (f) {
    const from = w - 1 - width(f);
    line += " ".repeat(Math.max(1, from - at)) + f + RESET;
    hits.push({ from, to: w, dir: 1 });
  }
  return { line, hits };
}

/** A history row's click: back (-1), the trail (0, PIE-208) or forward (1). */
export type TrailDir = -1 | 0 | 1;
/** The action a history row's click runs. */
export const historyAction = (dir: TrailDir) => (dir < 0 ? "back" : dir > 0 ? "forward" : "trail") as "back" | "forward" | "trail";
/** The trail's chip on the history row, and the narrowest row that draws it. */
export const TRAIL_CHIP = "≡ trail";
const TRAIL_CHIP_MIN = 40;
/** One stop on a reader's trail (PIE-208): the note there, by its title as it was when the reader was there. */
export interface TrailStop { id?: string; title: string; address?: Msg["address"] }
/** A reader's trail as the trail answers it: the note shown, the stops back and forward, nearest first. */
export interface Trail { here: { id: string; title: string } | null; back: TrailStop[]; forward: TrailStop[]; keptBy?: string }
/** One row of the trail as its list and its tile draw it: the stops ahead (→) above the note shown (●), the ones back (←) below. */
export interface TrailRow { dir: -1 | 0 | 1; steps: number; title: string }
export const trailRows = (t: Trail): TrailRow[] => [
  ...t.forward.map((s, i) => ({ dir: 1 as const, steps: i + 1, title: s.title })).reverse(),
  { dir: 0, steps: 0, title: t.here?.title ?? "(nothing shown)" },
  ...t.back.map((s, i) => ({ dir: -1 as const, steps: i + 1, title: s.title })),
];
/** A trail row's words: `← title · 2 back`, `● title · here`. */
export const trailLine = (r: TrailRow) => ` ${r.dir < 0 ? "←" : r.dir > 0 ? "→" : "●"} ${printable(r.title)}${r.dir ? ` · ${r.steps} ${r.dir < 0 ? "back" : "ahead"}` : " · here"}`;

/** What a host's header can say that only the surface knows: where the note sits, its comments and properties. */
export interface HeaderInfo {
  /** The note's ancestors, "…" while they're read, "top level" for a root. */
  crumbs: string;
  /** Comment threads on the note, once read (null until then). */
  comments: { open: number; total: number } | null;
  /** How many properties the panel (`i`) lists. */
  properties: number;
}

/** How much of the heading colour the title keeps in a tile that doesn't have the keys: a clear step down (not further: the night theme's text must keep 4.5:1), never brighter than the theme allows. */
const TITLE_UNFOCUSED = 0.7;

/**
 * The reader's header rows a note leaves out (PIE-1319): its `[header::…]` values, as outline-core's `header` schema
 * describes them (`none`, `crumbs`, `title`, or several). The note decides, so it follows the note into every reader.
 */
export function headerOmits(m: Pick<Msg, "properties">): { crumbs: boolean; title: boolean; byline: boolean } {
  const said = new Set(propValues(m, "header").map(v => v.trim().toLowerCase()));
  const is = (v: keyof typeof HEADER_VALUES) => said.has(v) || said.has("none");
  return { crumbs: is("crumbs"), title: is("title"), byline: is("none") };
}

/** A tile's own header (PIE-1248, `tile.header`): what its reader draws above the note, whatever the note says. */
export const TILE_HEADERS = {
  full: "the crumbs, the title and the byline",
  title: "the title alone, on one line",
  none: "no header: the note starts on the first row",
} as const;
export type TileHeader = keyof typeof TILE_HEADERS;
export const isTileHeader = (v: unknown): v is TileHeader => typeof v === "string" && v in TILE_HEADERS;

/** A note that is only embeds (a figure or a part shown on its own), properties aside: nothing of its own to head. */
export function embedOnly(m: Pick<Msg, "text">): boolean {
  const embeds = embedOccurrences(m.text);
  if (!embeds.length) return false;
  let rest = "", at = 0;
  for (const e of embeds) { rest += m.text.slice(at, e.start); at = e.end; }
  rest += m.text.slice(at);
  const h = headerLine(rest);
  return h.line < 0 || (!h.prose.trim() && rest.split("\n").slice(h.line + 1).every(l => !l.trim()));
}

/**
 * The reader's header rows left out, one answer for every reader (PIE-1248): the tile's own setting when it has one
 * (`tile.header`: full, title alone on one line, none), else the note's `[header::…]` (PIE-1319), else none for a note
 * that is only embeds (an attached figure), else all of them. `oneLine`: the title isn't wrapped.
 */
export function headerShown(m: Pick<Msg, "properties" | "text">, tile?: TileHeader): { crumbs: boolean; title: boolean; byline: boolean; oneLine: boolean } {
  if (tile === "full") return { crumbs: false, title: false, byline: false, oneLine: false };
  if (tile === "title") return { crumbs: true, title: false, byline: true, oneLine: true };
  if (tile === "none" || (!propValues(m, "header").length && embedOnly(m))) return { crumbs: true, title: true, byline: true, oneLine: false };
  return { ...headerOmits(m), oneLine: false };
}

/** The reader's header rows (NoteSurface.headerBlock): where its summary line is and its links, and its title's row. */
interface HeaderBlock {
  rows: string[]; summary: string; summaryRow: number;
  summaryLinks: { from: number; to: number; link: Link; key: string }[];
  /** The title's rows (null: a host's own header stands in for it, or the note leaves it out). */
  title: { row: number; rows: number } | null;
  /** A host's own header (the BBS message header) stands in for the title, byline and crumbs. */
  own?: boolean;
  /** The crumbs' row (the path above the title), where a click shows the note in the outline; null: a host's own header. */
  crumbsRow?: number;
  /** The byline's [comment] (PIE-846): a click writes a comment on the whole note, as C with nothing selected does. */
  commentChip?: { row: number; from: number; to: number };
  sourcesChip?: { row: number; from: number; to: number };
  /** The byline's comment count (PIE-873): a click cycles the margin, as M does. */
  marginChip?: { row: number; from: number; to: number };
  /** Marks only (PIE-873): the whole-note threads' one mark after the title, and the thread a click opens. */
  titleControls?: { row: number; from: number; to: number; link: Link }[];
  wholeMarks?: { row: number; from: number; to: number; thread: string }[];
}

/** A note laid out by a reader (NoteSurface.layOut), and what it was laid out for (`m`, `key`). */
interface Laid {
  m: Msg; key: string; doc: Doc; drawn: Link[]; picks: { at: number; lines: number; rows: number[] } | null;
  controls: Control[]; body: string[]; marks: Mark[]; lines: number[]; elems: Element[];
  /** The margin's side column (ADR 0004 contract 6): its width (0: cards fold under their passages), and its cards. */
  margin: { cols: number; cards: { thread: string; at: number; rows: string[]; controls: Control[]; images: DocImage[]; links: LinkRange[] }[] };
  /** The annotations' and span rules' marks on the words, by content row: columns and background. Filled on first paint. */
  spans?: Map<number, { from: number; to: number; bg: string }[]>;
  /**
   * The comment being written (PIE-770): its passage's body rows [from, to), and the inline box (src/surface/composer.ts)
   * from body row `at`, its frame in the box's own cells (placed on screen each paint, after the scroll).
   */
  sourcesInline?: { at: number; cols: number; rows: number };
  listInline?: { at: number; cols: number; rows: number };
  composer: { passage: [number, number] | null; inline: { at: number; box: ComposerBox } | null; after: number | null } | null;
}

/** `scroll`: where a reading view is in its note (the frames draw a thumb and `· NN%` from it). */
export interface SurfaceView { frame?: FloatRect; headerBand?: { row: number; rows: number; bg: string }; completion?: Completer; gutter?: { row: number; text: string }[]; lines: string[]; placements?: Placement[]; scroll?: Scroll }
export type Link = LinkTarget;

/**
 * The compare a reader opens (PIE-1433): revision `revision` (left out: the one before the note now) against the next
 * one kept, or against the note now. The person's and an agent's revision.compare both ask it.
 */
async function compareAt(board: SocketBoard, id: string, revision: number | undefined, against: RevisionAgainst) {
  const list = await board.revisions(id);
  const from = revision ?? list.revisions.find(r => r.revision < list.revision)?.revision;
  if (from === undefined) throw new ActionRefused(`no earlier text is kept for this note (it is at revision ${list.revision}; the outline keeps a note's newest 100 texts)`);
  return revisionDiff(board, id, from, against === "now" ? list.revision : undefined, list);
}
/** Two links name the same target the same way (a click finds the `[ ]` link it is). */
/** The density after `d`, round again: compact, cozy, comfortable. */
const nextDensity = (d: Density): Density => DENSITIES[(DENSITIES.indexOf(d) + 1) % DENSITIES.length]!;
/** A live figure's tab or density control, named across renders (its figure's key, then which). */
const figureElemBase = (c: FigureControl) => `figure:${c.figure}|${c.tab !== undefined ? `tab:${c.tab}` : "density"}`;
const sameLink = (a: Link, b: Link) => a.tag === b.tag && a.resource?.key === b.resource?.key && a.block === b.block && a.fragment === b.fragment && a.label === b.label && a.page === b.page && a.media === b.media && a.url === b.url;
/** The same element's link in another draw: a press by its button's place, anything else as sameLink, of the same role. */
const sameElementLink = (a: Link, b: Link) => a.press || b.press
  ? !!a.press && !!b.press && a.press.block === b.press.block && a.press.line === b.press.line && a.label === b.label
  : a.role === b.role && sameLink(a, b) && same(a.task, b.task, taskBase) && same(a.callout, b.callout, calloutBase)
    && same(a.figure, b.figure, figureElemBase) && a.inlineList?.key === b.inlineList?.key && a.inlineList?.row === b.inlineList?.row
    && a.listRow?.key === b.listRow?.key && a.listRow?.row === b.listRow?.row;
const same = <T,>(a: T | undefined, b: T | undefined, base: (x: T) => unknown) => (a && b ? base(a) === base(b) : !a === !b);
/**
 * Where a click lands in the last render, in the surface's own cells: a link (the body's, an embed's
 * title or result, a summary value), or a row of the property panel (`follow`: its value names a target).
 */
/** `value`: a summary-line value's property key; it follows as the panel's `o` does (followValue). */
/** `copy`: the selection's copy control (PIE-419), which copies what's drawn or its source. */
/** `elem`: the `[ ]` element the link is (PIE-441); `thread`: a comment mark in the margin, or a control of a thread expanded under its passage (PIE-420). */
/** `history`: the history row's `← back` (-1) or `forward →` (1), PIE-453. */
/** `pick`: a row of the open choice (a step's status, PIE-472; a callout's type, PIE-538), by its index. */
type Hit = { row: number; from: number; to: number } & ({ link: Link; value?: string; elem?: string } | { prop: number; follow: boolean } | { copy: "visible" | "source" } | { block: number } | { thread: string; elem: string } | { history: TrailDir } | { pick: number } | { image: string } | { passage: string } | { crumbs: true } | { start: SessionKind } | { margin: true } | { fold: number } | { listPreview: number } | { region: string } | { sources: true } | { zoom: number });

/**
 * What `[ ]` stops on (PIE-441), in reading order: a link (in the text, the summary line, or an image or
 * video), a fold point (a heading or a list item with lines under it), a row that stands for a note (a live
 * figure's row, an embedded view's result), an embed (its title), a resource projection (its region, PIE-445)
 * and a comment mark (in the margin).
 */
/** A body's hooks with the proposals beside the note drawn after their lines, after whatever else follows those lines. */
function withBeside(hooks: Partial<DocEnv>, beside: Map<number, ((width: number) => string[])[]>): Partial<DocEnv> {
  if (!beside.size) return hooks;
  const after = hooks.after;
  return { ...hooks, after: (line, width) => joinRows([after?.(line, width) ?? [], ...(beside.get(line) ?? []).map(draw => draw(width))]) };
}

/** The elements that are one row inside a container (a figure's row, a step): the reader item-focuses them (PIE-969). */
const ITEM_KINDS = new Set<ElementKind>(["row", "task"]);
export type ElementKind = "link" | "fold" | "row" | "embed" | "comment" | "control" | "resource" | "task" | "callout" | "figure" | "block";
/**
 * The controls of a comment thread expanded inline (PIE-420): Select, Reply, Seen (or Bring back), Keep (or Unkeep), TL;DR;
 * Quote (the thread's mark, or a reply's: `value` names the reply); a "quoted in" line opens the block quoting it.
 */
export type ThreadControl = "select" | "reply" | "edit" | "seen" | "keep" | "tldr" | "untldr" | "toggle" | "card" | "quote" | "quoted";
/**
 * One element where the last render drew it. Rows are content rows: the header's, then the body's (so the
 * header's stay put and the body's move with the scroll). `ruler`: the rows [from, to) of the block it's in,
 * which the reading ruler tints while it's current. `key` names it across renders.
 */
interface Element {
  key: string; kind: ElementKind; row: number; from: number; to: number; ruler: [number, number]; label: string;
  /** A row or step: the rows [from, to) of that one item (its own lines, never its figure's), which item focus bands (PIE-969). */
  item?: [number, number];
  previewLine?: number; link?: Link; value?: string; fold?: string; thread?: string; control?: ThreadControl;
  /** A generated region's mark in the gutter (src/output-region.ts): the region's key. `[ ]` on it opens what is behind it. */
  region?: string;
  /** A checklist step's box (PIE-472): the step as it was read where it's drawn. */
  task?: StepRef;
  /** A callout's icon and type (PIE-538): the callout as it was read where it's drawn. */
  callout?: CalloutRef;
  /** A code block's or quote's (PIE-638): which of the drawn document's blocks (`doc.blocks`) it is. */
  block?: number;
}
/** What ⏎ does on a kept-draft line's control. */
const UNSENT_VERB: Record<UnsentOp, string> = { diff: "show what your edit changed against the note now", copy: "open its copy", dismiss: "let it go (its copy stays on disk)", add: "add the lines the note doesn't have into an edit", keep: "keep it as a note under this one", show: "show the old edits" };
/** The copy control of a code block, a quote or a callout (PIE-638). */
const COPY_GLYPH = "⧉";
/** The zoom control's glyph (PIE-780): a part fills the tile. */
const ZOOM_GLYPH = "⤢";
/** How many of a block's first rows its copy control looks through for a free cell. */
export const COPY_ROWS = 4;
/** What ⏎ does on an element, for the hint. `open`: a fold is folded, a comment mark's thread is expanded. */
const verbOf = (e: Element, open: boolean) =>
  e.link?.ext ? extVerb(e.link.ext)
  : e.kind === "fold" ? (open ? "unfold" : "fold") : e.kind === "comment" ? (open ? "fold its card back to its [+]" : "open its card")
  : e.kind === "control" && e.link?.proposal?.op ? (e.link.proposal.op === "apply" ? "apply it anyway" : e.link.proposal.op === "resolve" ? "resolve it" : "dismiss it")
  : e.kind === "control" && e.link?.unsent ? UNSENT_VERB[e.link.unsent.op]
  : e.kind === "control" && e.link?.use ? "ask for what the ::use needs"
  : e.kind === "control" ? (e.control === "select" ? "select its passage" : e.control === "reply" ? "reply" : e.control === "edit" ? (e.value ? "edit the reply" : "edit the comment") : e.control === "card" ? "open its card" : e.control === "quote" ? "quote it into a new block" : e.control === "quoted" ? "open the block quoting it" : e.control === "tldr" ? "ask @margin for its TL;DR" : e.label.toLowerCase())
  : e.kind === "figure" ? (e.link?.figure?.tab !== undefined ? "show this tab" : "change the density") : e.kind === "row" ? "open its note" : e.kind === "embed" ? "open it" : e.kind === "task" ? "status" : e.kind === "callout" ? "choose its type"
  : e.kind === "block" ? "copy it"
  : e.kind === "resource" ? (e.link?.url ? "open the ticket's page" : "say why there's nothing to open") : e.link?.resource ? "show the resource" : e.link?.value ? (e.link.value.problem ?? (e.link.at !== undefined ? "show the line it reads" : "say how it is computed")) : e.link?.media || e.link?.url ? "open" : "follow";
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
interface Mark { col?: number; thread: string; open: boolean; row: number; rows: [number, number]; label: string }
/** A thread control where the last render drew it: its body row, and columns in the body's own cells (no margin). */
interface Control { thread: string; control: ThreadControl; row: number; from: number; to: number; label: string; value?: string }

/**
 * The note's links in reading order, as outline-core's scan finds them: `((…))` (transclusions too), `[[…]]` and
 * Markdown `[text](url)`.
 */
const linksOf = (m: Msg): Link[] => linkOccurrences(m.text).map(linkOf);
/** One link of outline-core's scan as the reader follows it. */
const linkOf = (l: LinkOccurrence): Link => {
  if (l.kind === "block") return { block: l.blockId, ...(l.fragmentId ? { fragment: l.fragmentId } : {}), ...(l.label !== undefined ? { label: l.label } : {}) };
  if (l.kind === "page") return { page: l.displayAddress, ...(l.fragmentId ? { fragment: l.fragmentId } : {}), ...(l.label !== undefined ? { label: l.label } : {}) };
  return { url: l.url, label: l.text };
};
/**
 * A link a draft's preview draws as `edit.follow`'s `ref=` (PIE-592): `((id^fragment))`, `[[page]]`, a URL or `#tag`;
 * null for one that has no such words (a resource token, a picture).
 */
export const refOfLink = (l: Link): string | null =>
  l.block ? `((${l.block}${l.fragment ? `^${l.fragment}` : ""}))` : l.page !== undefined ? `[[${l.page}${l.fragment ? `^${l.fragment}` : ""}]]` : l.url !== undefined ? l.url : l.tag !== undefined ? `#${l.tag}` : null;
/** `edit.follow`'s `ref=` back to the link it names: what `refOfLink` writes, or one link written whole. */
function linkOfRef(ref: string): Link | null {
  const text = ref.trim();
  if (text.startsWith("#") && text.length > 1) return { tag: text.slice(1) };
  const [l] = linkOccurrences(text, []);
  if (l && l.start === 0 && l.end === text.length) return linkOf(l);
  if (/^[a-z][a-z0-9+.-]*:\S+$/i.test(text)) return { url: text };
  const b = referencedBlock(text);
  return b ? { block: b.blockId, ...(b.fragment ? { fragment: b.fragment } : {}) } : null;
}
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
export function readableSource(m: Msg, src: Source | null): ReadableSource {
  // A function of the text and the tokens the service gave it, asked several times a frame by a reader and by what it draws
  // (the folds, the cursor, the hint): answered once while none of what it reads changes: the text, the tokens, the extensions listed.
  const tokens = tokensOf(m.text, src), given = tokens?.state === "ready" ? tokens.tokens : tokens?.state ?? null, mentions = mentionsStamp();
  const kept = READABLE.get(m.text);
  if (kept && kept.given === given && kept.mentions === mentions) return kept.read;
  const read = readableSourceOf(m, tokens);
  if (READABLE.size >= 200) READABLE.clear();
  READABLE.set(m.text, { given, mentions, read });
  return read;
}
type ReadableSource = { text: string; lines: number[]; anchors: (string | undefined)[]; literal: Set<number>; unterminated: number | null };
const READABLE = new Map<string, { given: unknown; mentions: RegExp | null; read: ReadableSource }>();
function readableSourceOf(m: Msg, tokens: ReturnType<typeof tokensOf>): ReadableSource {
  const hidden = metadataLines(m.text, tokens?.state === "ready" ? tokens.tokens : null);
  const lit = literalLines(m.text);
  // The title may come from a later line (a marker or a props-only line first): what's above it isn't body.
  const title = Math.max(0, titleLine(m.text).line);
  const all = m.text.split("\n"), code = codeFenceLines(all);
  // A note that is only embeds (PIE-1248) has its first embed on the title line: it is the body, drawn as its words
  // without the chips (its header starts as none, so nothing else would show it).
  const head = embedOnly(m) ? headerLine(m.text) : null, embedTitle = head?.line === title ? head : null;
  const rows = all.map((l, i) => ({ l: embedTitle && i === title ? embedTitle.prose : l, i })).filter(({ i }) => (i > title || (!!embedTitle && i === title)) && (!hidden.has(i) || mentionsExtensionLine(all[i]!)) && !lit.markers.has(i))
    // A stable fragment anchor (`## Beds ^beds`) is an address, not prose: read mode hides it, as Detail does.
    .map(({ l, i }) => {
      const a = code[i]! >= 0 ? null : fragmentAnchorMatch(l);
      return a ? { l: l.slice(0, a.index).trimEnd(), i, anchor: a[1] } : { l, i };
    });
  // Blank lines before the first line with text aren't drawn.
  let lead = 0;
  while (lead < rows.length - 1 && rows[lead]!.l === "") lead++;
  const kept: { l: string; i: number; anchor?: string }[] = rows.slice(lead);
  // The block-level tags (PIE-880, outline-core's blockTags) are the first row of the body, so hiding the properties
  // doesn't hide them: one row under the byline, each a tag link, then a blank row. The row stands for its metadata line.
  const row = blockTags(m.text, tokens?.state === "ready" ? tokens.tokens : null);
  if (row.tags.length) kept.unshift({ l: row.tags.map(t => `#${t}`).join(" "), i: row.line }, ...(kept.length ? [{ l: "", i: row.line }] : []));
  const literal = new Set<number>();
  kept.forEach((r, k) => { if (lit.inside.has(r.i)) literal.add(k); });
  return { text: kept.map(r => r.l).join("\n"), lines: kept.map(r => r.i), anchors: kept.map(r => ("anchor" in r ? r.anchor : undefined)), literal, unterminated: lit.unterminated };
}
/** Text from elsewhere (an extension's output) without control characters, its lines and tabs kept. */
const printableBlock = (s: string) => printable(s, "", { lines: true });
/** A link drawn: its text, tagged with its place in `drawn` (what [ ], ⏎ and a click find it by). */
const tagged = (drawn: Link[], to: Link, text: string) => linkTag(drawn.push(to) - 1) + text + LINK_END;

/**
 * An extension view's picture (PIE-827) as rows `width` wide, laid out as a note's image line is (doc.ts mediaRows: its
 * box kept dark while it loads, dimmed dark-first, its caption; graphics off, the caption says why). Its first row
 * carries a zero-width tag naming the picture, so wherever the view puts it (a card, a box, one side of a row)
 * placePictures finds it; its caption is a link to the file, so `[ ]` stops on it and ⏎ opens it, as on a note's image.
 */
function pictureRows(node: ImagePrimitive, width: number, env: DocEnv, drawn: Link[]): string[] {
  const r = mediaRows(imagePrimitiveSpec(node), width, { ...env, image: undefined }, -1);
  const lines = [...r.lines];
  if (r.image) lines[r.image.line] = " ".repeat(r.image.col) + tagged(drawn, { role: "picture", picture: r.image }, " ".repeat(r.image.cols));
  // `caption: false` (PIE-839): the picture alone, once its rows are kept for it; where it isn't drawn, the caption says what it is.
  if (node.caption === false && r.caption > 0) return lines.slice(0, r.caption);
  lines[r.caption] = tagged(drawn, { media: r.entry.path }, lines[r.caption]!);
  return lines;
}

/** The pictures extension views drew in `doc` (pictureRows), each placed where its tag landed. */
function placePictures(doc: Doc, drawn: readonly Link[]): void {
  const seen = new Set<number>();
  for (const r of doc.links) {
    const picture = drawn[r.n]?.picture;
    if (!picture || seen.has(r.n)) continue;
    seen.add(r.n);
    doc.images.push({ ...picture, line: r.line, col: r.from });
  }
}
/** ctrl+s on a comment or reply being written (not while its completion popup is open, which takes keys first). */

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
/** A note at a revision, beside how it is now (PIE-1433): the compare's view, its header's controls and where it was drawn. */
type RevisionMode = ReaderMode<SurfaceHost> & { blockId: string; view: RevisionView; want?: number; controls: { from: number; to: number; action: (typeof REVISION_CONTROLS)[number] }[]; body: number; rect: { x: number; y: number; w: number; h: number } };
type ReplyLinksMode = ReaderMode<SurfaceHost> & { controls: { from: number; to: number; action: (typeof REPLIES_CONTROLS)[number] }[]; dragFrom?: { block: Msg; y: number }; truncated: boolean; data: LinkData; selected: number; group: LinkGroupName | "thread"; thread: ThreadData; unfolded: Set<string>; presses: RowPresses; picked: boolean; top: number; rect: { x: number; y: number; w: number; h: number }; rowsAt: LinkRow[]; drawnItems: number[] };
type DraftMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { session: DraftSession; reply?: Msg; describe(): ReturnType<DraftSession["describe"]> & { writtenBy: string | null } };
type CommentMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { session: CommentSession; describe(): ReturnType<CommentSession["describe"]> };
/** Moving and sizing the floating composer by keys (ctrl+g, PIE-785): arrows or h j k l move it, shift with them sizes it. */
type GripMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { describe(): { moving: true; float: FloatRect | null } };
/** comment.move's arguments: steps, a place, a size (the reader's cells), or back to the usual place. */
type ComposerMove = FloatMove;
type SplitFrame = { target: "comment" | "sources" | "list-preview" | "edit-preview"; beside: boolean; w: number; h: number; edge: number };
/** The person asked to go somewhere while a comment is unsent (PIE-785): what they asked for waits on their choice. */
interface LeaveAsk { what: string; name: keyof NoteActionArgs & string; args: Record<string, unknown>; elem?: string }
/** The answers to leaving an unsent comment, with their keys: the draft kept and on, back to writing, or let go. */
export type LeaveChoice = "save" | "keep" | "discard";
/** How the power bar says each answer (src/bar/ask.ts asks it). */
const LEAVE_SAYS: Record<LeaveChoice, string> = {
  save: "save and continue (kept unsent: C and the passage bring it back)",
  keep: "keep writing",
  discard: "discard (a copy stays on disk)",
};
type PanelMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { panel: PropertyPanel; describe(): { open: string; selected: number; note: string | null; editing: { n: number; key: string; text: string; revision: number; changedElsewhere: boolean; note: string | null } | null; rows: ReturnType<typeof describeRow>[] } | null };
type ListMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { list: string; describe(): { list: string; title: string | null; selected: string | null; typing: string | null } };
type SourcesMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { panel: SourcesPanel; reveal: boolean; place: AttachedPlace; float: FloatRect | null; frame: FloatRect | null; room: { w: number; h: number; col?: number; row?: number }; rect: { x: number; y: number; w: number; h: number }; draw: PanelDraw | null; view: Inspector; footer: number; describe(): unknown };
type PickerMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { picker: Picker; describe(): { step?: string | null; callout?: string | null; choices?: string[]; selected: string | undefined; note: string | null } };

/** How long a missing page's offer stands (PIE-544): the next ⏎ or click on its link within it makes the page. */
const PAGE_OFFER_MS = 60_000;

/** Agent actions that open an edit or a comment session on the note. */
const STARTS_SESSION = new Set(["edit", "edit.text", "passage.select", "comment.write", "comment", "threads", "reply", "comment.edit", "resolve", "thread.seen", "thread.keep", "thread.tldr"]);
/** The thread list's attention keys (PIE-791): s seen, p keep (k is up there), t TL;DR. */
const ATTENTION_KEYS: Record<string, "thread.seen" | "thread.keep" | "thread.tldr"> = { s: "thread.seen", p: "thread.keep", t: "thread.tldr", T: "thread.tldr" };

export class NoteSurface {
  msg: Msg | null = null;
  private rereadNote(m: Msg): Msg {
    if (m.id === this.msg?.id) m.address ??= this.msg.address;
    return m;
  }
  readonly position = new ReaderPosition();
  private positionRows = new PositionRows(this.position);
  get scroll() { return this.positionRows.top; }
  set scroll(value: number) { this.positionRows.top = value; }
  /** The furthest the note scrolls, from its last render (keys and the wheel stop there). */
  private maxScroll = Infinity;
  /** Where End stops first, from its last render: the last line on the bottom edge (PIE-622). */
  private endScroll = Infinity;
  /** End was pressed (scrollEnd): the stop it goes to, placed at the next render. */
  private endWant: "edge" | "last" | null = null;
  /** The last layout, reused by a frame that only scrolled. */
  private laid: Laid | null = null;
  /**
   * The body's inset from the reader's left edge, its right margin, and the blank rows above it, from the look's
   * `margin.x` and `margin.y` (PIE-673). The gutter sits outside this authored spacing.
   * Drawn, never text: a selection's copy starts after it.
   */
  private bx = 1;
  private gutterStart = 0;
  // Three cells fit a discoverable [+]; this is reader chrome, not authored spacing.
  gutterWidth(): number {
    const counts = new Map<number, number>(), lineOf = lineAtOffset(this.msg?.text ?? "");
    for (const c of this.comments ?? []) {
      // A whole-note thread's mark is after the title (headerBlock), so it takes no gutter column.
      const line = isWholeNote(c) || c.start === null ? null : lineOf(c.start);
      if (line !== null) counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    return this.printed ? 0 : 1 + (counts.size ? 3 * Math.max(...counts.values()) : 0);
  }
  private bxRight = 0;
  private my = 0;
  /** The look this reader was drawn with last (the host's, or the note's own levels): `peek` and the inspector read it. */
  lastLook: Look | null = null;
  /**
   * The `::box{…}` the current element is in (else the top row shown), as written: the tune inspector reads its block
   * level from it. Null outside one.
   */
  boxAt(): { attrs: string; line: number } | null {
    const d = this.drawn, m = this.msg;
    if (!d || !m) return null;
    const cur = this.elems.find(e => e.key === this.cur);
    const line = d.doc.source[cur ? cur.row - d.top : this.readingRows()?.[0] ?? this.scroll];
    if (line === undefined) return null;
    const b = componentBlocks(this.foldsIn(m).text.split("\n")).find(c => c.name === "box" && c.attrs !== undefined && line > c.start && line < c.end);
    return b ? { attrs: b.attrs!, line: b.start } : null;
  }
  /**
   * The list the current element is in, or the one below the heading or lead-in line it's on (else the top row shown),
   * for the tune inspector's `this list` (PIE-675): where a
   * save goes (its first item: `list:<note>:<line>`), its own
   * layers (with the tuning over them), and its first item's line. Null outside a list.
   */
  listAt(): { target: string | null; layers: StyleLayer[]; first: number; revision?: number; component?: boolean } | null {
    const d = this.drawn, m = this.msg;
    if (!d || !m) return null;
    const cur = this.elems.find(e => e.key === this.cur);
    const at = d.doc.source[cur ? cur.row - d.top : this.readingRows()?.[0] ?? this.scroll];
    if (at === undefined) return null;
    const { text, lines } = this.foldsIn(m), body = text.split("\n");
    const component = componentBlocks(body).find(c => at >= c.start && at <= c.end && (c.name.startsWith("graph-") || ["links", "outlinks", "backlinks", "resources"].includes(c.name)));
    if (component) {
      const line = lines[component.start] ?? component.start;
      const fields = listFieldsTuned(this.src, m.id, line, componentRowFields(component.attrs ?? ""));
      return { component: true, target: listTarget(m.id, line), first: line, revision: m.revision, layers: [{ level: "block", label: "this list", block: m.id, line, fields }] };
    }
    // In a list; else on what owns one (its section's heading, or its lead-in line): the list below it.
    let first = listStart(body, at);
    const code = fencedLines(body);
    if (first === null && !code.has(at) && !code.has(at + 1) && LIST_ITEM.test(body[at + 1] ?? "")) first = at + 1;
    if (first === null && !code.has(at) && /^ {0,3}#{1,6}\s/.test(body[at] ?? "")) {
      for (let i = at + 1; i < body.length && (code.has(i) || !/^ {0,3}#{1,6}\s/.test(body[i]!)); i++) if (!code.has(i) && LIST_ITEM.test(body[i]!) && !/^\s/.test(body[i]!)) { first = i; break; }
    }
    if (first === null) return null;
    const layers = listLayers(body, first, m.id, n => lines[n] ?? n).map(l => ({ ...l, fields: listFieldsTuned(this.src, m.id, l.line!, l.fields) }));
    return { target: lines[first] === undefined ? null : listTarget(m.id, lines[first]!), layers, first: lines[first] ?? first, ...(m.revision !== undefined ? { revision: m.revision } : {}) };
  }
  /** The look for the note shown at `w`: the host's (the desk resolves its tile's), else the global and page levels. */
  private lookAt(m: Msg, w: number, host: SurfaceHost | undefined): Look {
    const look = host?.look ?? lookFor(this.src, { page: lookPage(m) }, w);
    this.lastLook = look;
    const mx = look.values["margin.x"];
    this.gutterStart = host?.externalGutter !== undefined ? -host.externalGutter : 0;
    this.bx = (host?.externalGutter !== undefined ? 0 : this.gutterWidth()) + Math.max(0, Math.min(mx, Math.floor(w / 4)));
    this.bxRight = Math.max(0, Math.min(mx - 1, Math.floor(w / 4)));
    this.my = look.values["margin.y"];
    return look;
  }
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
  /**
   * A link selected (`selectLink`) while the note wasn't laid out yet (shown again, not yet drawn): its element becomes
   * current at the next layout, unless the selection moved meanwhile.
   */
  private linkUnlaid: number | null = null;
  /** Bring the current element into view on the next render (after `[ ]`, `( )` or a fold). */
  private reveal = false;
  /**
   * The part of the note this reader is zoomed into (PIE-780, `element.zoom`): the reading render reads only its lines
   * (`foldsIn`), so the part fills the tile and stays interactive; back (and esc) returns to the whole note.
   */
  zoom: Zoom | null = null;
  /** Counts every change of `zoom` but a followed one (PIE-780): a part read again for an older revision, or after the person moved, is let go. */
  private zoomTurn = 0;
  /** The last zoomed source (`zoomed`), by what it was cut from: asked several times a frame. */
  private zoomedMemo: { r: object; z: Zoom; out: object } | null = null;
  /** A focus mark an agent (or the person, through `act`) set here: never the person's `[ ]` position. */
  /** The reveal this surface took last (`takeReveal`), so showing the note again doesn't scroll back to it. */
  private revealed: object | null = null;
  focusMark: { by: Actor; spec: FocusSpec; label: string; at: number; fragment?: boolean; line?: boolean; says?: string } | null = null;
  private revealMark = false;
  /**
   * Folded headings and list items (their FoldPoint keys): this reader's reading state, never the note's
   * text. Kept while the note refreshes or is edited elsewhere; cleared when the reader shows another note.
   */
  folded = new Set<string>();
  /**
   * Comment threads opened in full, by thread id: local reading state, also changeable by an agent acting for the person.
   */
  expanded = new Set<string>();
  /** Explicit folds suppress the compact margin card too, independently of the margin mode. */
  private foldedThreads = new Set<string>();
  /** The margin (ADR 0004 contract 6): cards trimmed to a row, whole, or off (the spans stay). The person's reading state. */
  marginMode: MarginMode = "trim";
  /** `a` was pressed with text selected: the passage toolbar has the next key. */
  passageMenu = false;
  /**
   * The person's Comment or Ask from the toolbar: the comment the next session on the selection starts writing. `at`:
   * the passage it's on when that isn't the selection (passage.act's quote=: EchoNet's reply and quote-reply).
   */
  writeNext: { props: Record<string, string> | null; text: string; at?: { from: number; to: number } } | null = null;
  /**
   * Each live figure's chosen tab and density (src/graphs.ts), by the figure's key (its place among the note's figures
   * and its title): like `folded`, this reader's reading state, kept across repaints and live answers, never written
   * into the note, cleared when the reader shows another note.
   */
  figureUI = new Map<string, FigureChoice>();
  private inlineLists = new Map<number, InlineList>();
  /** The figures the last layout drew (their tabs, counts, what's chosen): what `figure.tab` and `figures` name. */
  figuresDrawn: FigureInfo[] = [];
  /**
   * The list of each inline component this reader draws (PIE-693, PIE-747), by its key (`^name`, else its place among the
   * note's components): the person's and the agents' picks and filters, the typed filter and the scroll. Like
   * `figureUI`, this reader's reading state, never written into the note, cleared when the reader shows another note.
   */
  listViews = new Map<string, ListView<any>>();
  /** What the inline lists of the layout being drawn are lent (set by `body`, read by the extension views drawn inside it). */
  private listEnv: LinkBlocksEnv | undefined;
  /** The inline components the last layout drew (their lists, the selection, the preview): what `list.*` name. */
  linkBlocksDrawn: ListHandle<any>[] = [];
  /** Presses on an inline component's rows: a second soon after on the same row opens it (RowPresses). */
  private linkPresses = new RowPresses();
  /** The person is typing a filter into an inline list: p, e and the rest are letters then, not the screen's keys (a pane's `typing`). */
  get typingFilter(): boolean { return !!this.listIn && !!this.listViews.get(this.listIn)?.typing; }
  /** The one-line field with the keys (a list's filter, a property's value): ctrl+w erases its word, not the window chord (PIE-1290). */
  get lineField(): LineField | null { return (this.listIn ? this.listViews.get(this.listIn)?.typing : null) ?? this.panel?.field?.input ?? null; }
  /** The key of the list the person went into (`list.enter`), or null. */
  get listIn(): string | null { return (this.modes.get("list") as ListMode | null)?.list ?? null; }
  /** The thread a Reply control asked to answer: the thread list opening next starts the reply there. */
  private replyOn: string | null = null;
  /** The comment (or one of its replies) an Edit control asked to edit (PIE-763): the thread list opening next starts the edit. */
  private editOn: { thread: string; reply?: string } | null = null;
  /** The fold point selected (its key), which `f` and ⏎ fold or unfold: the current element, when it's a fold. */
  private get foldSel(): string | null { return this.cur?.startsWith("fold:") ? this.cur.slice(5) : null; }
  private set foldSel(key: string | null) {
    if (key !== null) { const e = this.elems.find(e => e.key === `fold:${key}`); if (e) this.setElem(e); else this.cur = `fold:${key}`; this.link = -1; }
    else if (this.foldSel !== null) this.cur = null;
  }
  private foldsOf: string | null = null;
  /**
   * The fold points this reader has met in its note: a callout written `[!type]-` is folded when it's first met
   * (PIE-538), and after that it's the person's to open or fold, like any other.
   */
  private foldSeen = new Set<string>();
  private previewHits: { row: number; from: number; to: number; link: Link }[] = [];
  private readonly listEditor = new Inspector();
  private previewLists = new Map<string, boolean>();
  private previewOpen = new Set<string>();
  readonly listPreview = { place: (attachedPlaceOf(readState<{ place?: string }>("list-preview-place.json")?.place) ?? "split") as AttachedPlace, float: null as FloatRect | null, rect: null as FloatRect | null, top: 0, max: 0 };
  private foldCache: { text: string; points: FoldPoint[]; lines: number[] } | null = null;
  /** The last reading render: where the body starts, how far it's scrolled, and its rows' sources and fold heads. */
  /** What the last render drew: `heroRows`, the rows of the header image above it (PIE-532), which every row here is under. */
  private drawn: { w: number; h: number; top: number; scroll: number; room: number; doc: Doc; lines: number[]; head: string[]; body: string[]; heroRows: number; roomAt: (s: number) => number; bx: number; my: number; titleRows: [number, number] } | null = null;
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
  /** Bring the comment being written into view at the next paint (it opened, the person typed, it moved: PIE-770). */
  private revealComposer = false;
  /** The rows of the comment's passage in the last paint, in the reader's cells (a floating box goes beside them). */
  private composerRows: [number, number] | null = null;
  /** Where the last paint put a floating or popup composer (PIE-785), in the note's cells under its header image, and the room it had. */
  private boxRect: FloatRect | null = null;
  readonly editPreview = { place: attachedPlaceOf(readState<{ place: string }>("edit-preview-place.json")?.place) ?? "inline", float: null as FloatRect | null, rect: null as FloatRect | null, frame: null as FloatRect | null, room: { w: 0, h: 0 } as { w: number; h: number; col?: number; row?: number } };
  private readonly attachmentTiles = { comment: new AttachedTile(), sources: new AttachedTile(), "list-preview": new AttachedTile(), "edit-preview": new AttachedTile() };
  private innerFrame?: FloatRect;
  private boxRoom: { w: number; h: number; col?: number; row?: number } | null = null;
  /** A press on a floating composer's top edge or ◢ corner: the drag moves or sizes it (comment.move) from where it was. */
  private frameDrag: { target: "comment" | "sources" | "edit-preview"; zone: NonNullable<ReturnType<typeof frameZone>>; x: number; y: number; from: FloatRect } | null = null;
  /** Where the person asked to go while their comment is unsent (PIE-785): it waits on their answer in the power bar. */
  private leaving: LeaveAsk | null = null;
  /** The cursor and selection of a draft the keys came back to by a press (PIE-812), put back after that press and its release. */
  private keptCursor: { d: Draft; row: number; col: number; anchor: Draft["anchor"]; follow: boolean } | null = null;
  /** A double or triple click's word or line being selected in a draft (two draft.place): its release copies it after. */
  private draftSelecting: Promise<void> | null = null;
  /** The last press in a draft was a shift+click (it extended the selection). */
  private shiftPress = false;
  private dragging = false;
  /**
   * What takes the reader's keys besides reading (src/surface/modes.ts): a step's status choice, the property
   * panel, the edit, the comment session, in their precedence. The fields below are views of it.
   */
  private splits: Record<"comment" | "sources" | "list-preview" | "edit-preview", AttachedSplit> = { comment: {}, sources: {}, "list-preview": {}, "edit-preview": readState<{ split?: AttachedSplit }>("edit-preview-place.json")?.split ?? { direction: "down", share: .5 } };
  private splitDrawn: SplitFrame[] = [];
  private splitDrag: SplitFrame | null = null;
  /**
   * The header image being dragged (PIE-1361): its bottom row sizes it (`height`), the picture moves what its crop keeps
   * (`focus`). Drawn from `now` while the button is down; one image.size or image.look on release, so the line takes
   * one save. A press that doesn't move is a click on the header.
   */
  /**
   * The header image as last placed, by its line: it stands in while it's dragged, and while a changed look (a blur, a
   * tint) is being made, so the header never goes blank under its rows (PIE-1361: the "margin" left behind).
   */
  private heroPlaced: { line: number; p: Placement } | null = null;
  private heroDrag: { kind: "height" | "focus"; x: number; y: number; rows: number; cols: number; focus: Focus; line: number; now?: { height?: number; focus?: Focus }; saving?: boolean } | null = null;
  private besideRect: { x: number; y: number; w: number; h: number } | null = null;
  private readonly forms = new Map<string, NoteForm>();
  get form(): NoteForm | null { return this.msg ? this.formOf(this.msg) : null; }
  private formOf(m: Msg): NoteForm | null {
    if (!isOutlineNote(m)) return null;
    let form = this.forms.get(m.id);
    if (!form) {
      form = new NoteForm(m.id, m.text);
      this.forms.set(m.id, form);
    }
    if (form.source !== m.text) form.update(m.text);
    return form.fields.length ? form : null;
  }
  focusForm(field: string, host: SurfaceHost) {
    const form = this.form;
    if (!form) throw new ActionRefused("this note has no form-field properties");
    form.focus = field === "@submit" ? form.fields.length : form.fields.findIndex(f => f.name === field);
    if (form.focus < 0) throw new ActionRefused(`the form has no field ${field}`);
    let saidEnded = false;
    const mode: ReaderMode<SurfaceHost> = {
      name: "form", of: form, word: "form", noun: "the form", holdsKeys: true,
      keys: FORM_KEYS,
      ended: () => {
        if (this.msg?.id !== form.block) return true;
        if (this.form) return false;
        if (!saidEnded) {
          saidEnded = true;
          host.ctx.flash("the form has no valid fields now; your answers are kept in this session");
        }
        return true;
      },
      editing: () => true, covers: () => false,
      key: (k, h) => form.key(k, (action, args) => { void this.runKey(action as keyof NoteActionArgs, args ?? {}, h); }),
      click: () => undefined, rows: () => null,
      leave: async () => { this.modes.drop("form"); return { left: "closed" }; },
      hint: () => "filling the form",
      state: () => "form", describe: () => ({ focus: form.fields[form.focus]?.name ?? "@submit", answers: form.values(USER) }),
    };
    this.modes.push(mode);
    const element = this.elems.find(e => e.link?.form?.field === field);
    if (element) { this.setElem(element); this.reveal = true; }
    host.enterMode?.(); host.redraw();
  }
  leaveForm() { this.modes.drop("form"); }
  private formHit(x: number, y: number) {
    return this.hits.find(h => "link" in h && h.link.form && h.row === y - (this.drawn?.heroRows ?? 0) && x >= h.from && x < h.to);
  }
  private readonly modes = new ModeStack<SurfaceHost>();
  /**
   * An open edit of `msg`: a draft session with the block adapter (src/draft-session.ts). While it exists
   * every key goes to it and the surface stays on its note.
   */
  get drafting(): DraftSession | null { return (this.modes.get("draft") as DraftMode | null)?.session ?? null; }
  /** The edit's text (the session's draft). */
  get replyLinks(): ReplyLinksMode | null { return this.modes.get("replies") as ReplyLinksMode | null; }
  get revisionMode(): RevisionMode | null { return this.modes.get("revision") as RevisionMode | null; }
  get replyParent(): Msg | null { return (this.modes.get("draft") as DraftMode | null)?.reply ?? null; }
  get draft(): Draft | null { return this.drafting?.draft ?? null; }
  /** The draft session the reader holds: its edit's, else its comment's text (the draft rule asks it, PIE-514). */
  draftSession(): DraftSession | null { return this.drafting ?? this.session?.writing ?? this.listEditor.field?.session ?? null; }
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
  set session(s: CommentSession | null) {
    // The person's comment takes the keys from the compare (an agent's never does), and gives them back when it closes.
    const rv = this.revisionMode;
    if (s) { this.modes.push(this.commentMode(s)); if (rv && s.startedBy.kind !== "agent") this.modes.focus(rv, false); return; }
    const cs = this.session;
    this.modes.drop("comment");
    if (rv) this.modes.focus(rv, true);
    if (this.modes.get("grip")?.of === cs) this.modes.drop("grip");
    if (this.sourcesMode) this.modes.focus(this.sourcesMode, true);
    if (this.placementMenu?.target === "comment") this.modes.drop("placement");
    this.leaving = null;
    if (this.frameDrag?.target === "comment") this.frameDrag = null;
    this.boxRect = null;
  }
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
  private context?: Ctx;
  /** Back and forward (PIE-453): the places this reader showed before, nearest last, and those back came from. */
  private backs: Place[] = [];
  private aheads: Place[] = [];
  /** The view's own history, from the last host seen (SurfaceHost.history), for `peek` and the hint. */
  private kept: ReaderHistory | null = null;
  private tracking = 0;
  /** The last host's note of a change to what the layout keeps (SurfaceHost.keptChanged). */
  private keptChanged: (() => void) | null = null;
  /**
   * A step's status choice, open under its box (PIE-472): the step's element key, the choice the keys are
   * on, and what the last choice said. The person's alone (an agent sets a status by `task.status`); it
   * holds the reader's keys until a choice is made or esc.
   */
  get picker(): Picker | null { return (this.modes.get("picker") as PickerMode | null)?.picker ?? null; }
  set picker(p: Picker | null) { if (p) this.modes.push(this.pickerMode(p)); else this.modes.drop("picker"); }
  /** The header image the last render drew above the note (PIE-532): its rows, and its image's element. */
  private hero: { line: number; full: number; pinned: boolean; over: boolean; max: number; picture: number } | null = null;
  /** The last digest's layout (its note, doc and note lines), for its host's sticky header (stickyHeader). */
  private digested: { m: Msg; w: number; maxImageRows: number; doc: Doc; lines: number[] } | null = null;
  /** The header's backdrop the last render drew (PIE-598): its image and note line, its step, and how it was drawn. */
  private backdropShown: { image: string; line: number; step: number; of: number; mode: HeroMode; drawn: "kitty" | "cells" | "making" | null; over?: string; focus?: Focus } | null = null;
  /** The note drawn as written, without the rules' decorations (PIE-600): `R`, decor.raw. The reader's own state. */
  raw = false;
  /** The step changes made in this reader, for Undo (ctrl+z, `task.undo`): each party undoes its own. */
  readonly stepHistory = new UndoHistory();
  /** The callout changes made in this reader (PIE-538), for Undo: each party undoes its own. */
  readonly calloutHistory = new UndoHistory<LineUndo>();
  /** Image layout changes (PIE-532) made here, for image.undo. */
  readonly imageHistory = new UndoHistory<LineUndo>();
  /** The props a `::use` line was given here (PIE-533 S4, use.fill), for use.undo. */
  readonly useHistory = new UndoHistory<LineUndo>();
  /** The step that last got its id here: its element key before and after (see keepCurrent). */
  private stepRenamed: { was: string; now: string } | null = null;
  /** The keys the last host keeps for itself (SurfaceHost.ownKeys), for the hint. */
  private hostKeys = "";
  private use(host: SurfaceHost | undefined): Source | null {
    if (host) { this.context = host.ctx; this.src = { board: host.ctx.board, redraw: () => host.redraw() }; this.kept = host.history ?? null; this.keptChanged = host.keptChanged ?? null; this.hostKeys = host.ownKeys ?? ""; }
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
  private sessionMode() { return this.modes.all().find(m => this.modes.active(m) && ["form", "draft", "comment", "panel", "replies", "sources", "list-preview"].includes(m.name)); }
  /** What the person is in here, by name ("edit", "comment", "property panel"), or null while reading. */
  sessionWord(): string | null { return this.sessionMode()?.word ?? null; }
  /** Typed text that isn't saved or sent: an edit, a comment being written, a property value. */
  unsaved() { return this.modes.unsaved(); }
  /** Copy unsaved text to disk (the screen is closing anyway); kept where it was written too, so opening it again brings it back. */
  keepDrafts(): string[] { return this.modes.keep(); }

  /**
   * What opens the person's edit or comment here again after a handover (src/session/restore.ts), as the actions that
   * open it: the edit; or the comment on its passage (a reply on its thread, an edit of a posted one), then where it
   * sits, its size and its preview (PIE-847). The draft session keeps its text, cursor, view and history.
   */
  reopenSteps(): Omit<Step, "tile">[] {
    if (this.listEditor.field && this.msg) {
      const p = this.previewPoint();
      if (!p) return [];
      const line = this.foldsIn(this.msg).lines[p.line]! + 1;
      return [{ action: "list.preview", args: { line, on: true } }, { action: "reading.place", args: { line } },
        { action: "list.preview.place", args: { place: this.listPreview.place } }, { action: "list.preview.edit", opens: "edit" }];
    }
    if (this.replyParent) return [{ action: "note.reply", opens: "edit" }];
    if (this.draft) return [{ action: "edit", opens: "edit" },
      ...(elementEdit(this.draft).on ? [{ action: "rich.toggle", args: { on: true } }] : []),
    ];
    const cs = this.session, d = cs?.mode === "compose" ? cs.composer : null, t = cs?.target;
    if (!cs || !d || !t || cs.startedBy.kind !== "user") return [];
    // words: something was typed, so its text was put aside and must come back (an empty comment has nothing to bring).
    const open: Omit<Step, "tile"> = { opens: "comment", ...(d.text.trim() ? { words: true } : {}), ...(t.kind === "quote" ? { action: "passage.act", args: { action: cs.props?.kind === "question" ? "ask" : "comment", quote: t.passage.quote, near: t.passage.start } }
      : t.kind === "note" ? { action: "comment.note", args: {} }
      : t.kind === "reply" ? { action: "reply", args: { thread: t.thread.id } }
      : { action: "comment.edit", args: { thread: t.thread.id, ...(t.mark.reply ? { reply: t.mark.id } : {}) } }) };
    return [
      open,
      { action: "comment.place", args: { place: cs.place } },
      ...(cs.place === "floating" && cs.float ? [{ action: "comment.move", args: { ...cs.float } }] : []),
      ...(d.preview ? [{ action: "draft.preview", args: { on: true } }] : []),
    ];
  }

  /** "editing · unsaved", "writing", "quoting", "comments", "properties", or null while reading. For the host's title. */
  state(): string | null {
    for (const m of this.modes.all()) { const st = m.state(); if (st) return st; }
    return null;
  }

  /** Refusals name the draft that holds the note, even while its preview has the keys. */
  holdingHint(): string {
    const d = this.draft;
    return d ? editHint(d, { save: "save", follow: true, reload: d.conflict || d.changedElsewhere ? "reload" : null })
      : this.modes.all().find(mode => mode.editing())?.hint() ?? "";
  }

  /** A selected element or active mode owns the hint before a host offers its reading shortcuts. */
  contextualHint(): string | null {
    const mode = this.modes.top();
    if (mode) return mode.hint();
    const attached = this.modes.all().find(m => m.name === "sources");
    if (attached) return "reader has keys · " + modeHint(attached.keys!.filter(row => row.key === "esc"), action => NOTE_ACTIONS.def(action));
    const rows = this.selection && this.selRows();
    if (rows) return selectionHint(this.selection!, [...this.selection!.text(rows)].length);
    const points = this.msg && !this.msg.partial ? this.visibleFolds(this.msg) : [];
    const sel = this.selectedFold(), f = sel ? points.indexOf(sel) : -1;
    if (f >= 0) { const p = points[f]!; return `fold ${f + 1}/${points.length} ${foldLabel(p)} · ⏎ f ${this.effectiveFolded(p) ? "unfold" : "fold"} · F all · ( ) next · [ ] elements`; }
    // The current element, named (PIE-441); one an agent's mark scrolled away is named, but ⏎ waits for it.
    const away = !this.inView() && this.drawn ? this.elems.find(x => x.key === this.cur) : undefined;
    if (away) return `[ ] ${this.elems.indexOf(away) + 1}/${this.elems.length} · ${away.kind} ${printable(away.label)} · out of view · [ ] steps on from it`;
    const e = this.inView(), i = e ? this.elems.indexOf(e) : -1;
    // A proposal's keys go first: in a narrow tile the hint is cut from the end.
    // An extension's line or control: its keys go first, as a proposal's do.
    if (e?.link?.press) return `[ ] ${i + 1}/${this.elems.length} · press ${printable(e.label)} · ⏎ runs ${printable(e.link.press.act.replaceAll("\n", " -> "))}`;
    if (e?.link?.ext) return `[ ] ${i + 1}/${this.elems.length} · ${extKeys(e.link.ext, this.hostKeys)} · ${e.kind === "control" ? "control" : "line"} ${printable(e.label)} · ⏎ ${verbOf(e, false)}${e.kind === "resource" ? " · y copy" : ""}`;
    // A table row's label keeps its columns' gaps: one space each here, since two spaces part a hint row's keys (hintKeys).
    if (e && e.kind !== "fold") return `[ ] ${i + 1}/${this.elems.length} · ${e.link?.proposal ? this.proposalKeys(e.link.proposal.id) : ""}${e.kind === "task" ? "step" : e.kind} ${e.link?.media ? "▣ " : ""}${printable(e.label).replace(/\s{2,}/g, " ")} · ⏎ ${verbOf(e, e.kind === "comment" && this.threadShown(e.thread!))}${opens(e) ? " · alt⏎ new" : ""}${e.kind === "resource" || e.kind === "block" ? " · y copy" : ""}${e.kind === "task" ? " · space done/to do · ctrl+z undo" : ""}${this.figureHint()} · ${this.zoomHint()}`;
    // A link selected without a drawn body (the river's column, or one `link.select` named that isn't drawn).
    const l = !this.cur ? this.links[this.link] : undefined;
    if (l) return `link ${this.link + 1}/${this.links.length} ${l.media ? "▣ " : ""}${printable(linkText(l, this.msg?.text ?? "", this.src))} · ⏎ ${l.media || l.url ? "open" : "follow"}`;
    return null;
  }

  /** The keys that work right now. `extra` goes before the reading keys (a host's own, like `p pin`). */
  hint(extra = ""): string {
    const context = this.contextualHint();
    if (context !== null) return context;
    // Back, and the trail (PIE-208) once there is somewhere to go either way.
    const back = (this.peek(-1) ? "alt← back · " : "") + (this.peek(-1) || this.peek(1) ? "alt+T trail · " : "");
    // Zoomed into a part (PIE-780): the way back first; else W zooms (the keys from ZOOM_KEYS, the table that binds them).
    const zoom = this.zoomHint();
    if (this.zoom) return `${extra}${zoom} · ${back}↑↓ j k blocks/rows · [ ] elements · f fold`;
    // A proposal an agent's patch left (PIE-501): A applies it anyway (unless it can't be applied), X dismisses it.
    const proposal = this.msg && isOpenProposal(this.msg) ? this.proposalKeys(this.msg.id) : "";
    return `${extra}${proposal}${back}↑↓ j k blocks/rows · ( ) sections · [ ] elements · ${zoom} · f fold · M comments mode · R reply · t thread · i properties · z callouts · u up · C comment · m comments`;
  }

  /** The zoom's keys (PIE-780) as the hint says them, read from ZOOM_KEYS: the way in, or while zoomed the way back. */
  private zoomHint(): string {
    const k = ZOOM_KEYS.find(k => k.key !== "click" && (k.args?.on === false) === !!this.zoom)!;
    return `${keyCaption(k.key)} ${this.zoom ? k.label : "zoom"}`;
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
    m.address ??= this.msg.address;
    this.msg = m;
    if (!this.draft || this.replyParent) this.links = linksOf(m);
    if (this.zoom && !m.partial && m.revision !== undefined && m.revision !== this.zoom.revision) void this.followZoom(m);
  }

  /** Show a note (or nothing). Refused, returning false, while an edit or a comment holds the surface on its note. */
  show(m: Msg | null, host: SurfaceHost): boolean {
    // An edit, a comment or a value being typed holds the reader on its note.
    if (this.modes.editing && m?.id !== this.msg?.id) return false;
    if (m && m.id === this.msg?.id && host.ctx.outline === this.msg.address?.outline) m.address ??= this.msg.address;
    this.use(host);
    if (m?.id !== this.msg?.id) { this.settled = null; this.notice = ""; this.pageOffer = null; this.agent = null; this.agentDraft = null; this.focusMark = null; this.picker = null; this.clearSelections(); if (this.panel) { this.panel.sel = 0; this.panel.view.reset(); this.panel.note = ""; } }
    if ((m?.id ?? null) !== this.foldsOf) { this.folded.clear(); this.foldSeen.clear(); this.previewLists.clear(); this.previewOpen.clear(); this.expanded.clear(); this.openedWhileOff.clear(); this.foldedThreads.clear(); this.figureUI.clear(); this.inlineLists.clear(); this.figuresDrawn = []; this.listViews.clear(); this.linkBlocksDrawn = []; this.modes.drop("list"); this.modes.drop("sources"); this.modes.drop("revision"); this.foldsOf = m?.id ?? null; this.zoom = null; this.zoomTurn++; }
    if (!this.draft) { this.position.view = null; this.position.reading = 0; this.position.cursor = { row: 0, col: 0 }; this.positionRows.reset(); }
    this.msg = m; if (!this.draft) this.scroll = 0; this.maxScroll = Infinity; this.endScroll = Infinity; this.endWant = null; this.letGo(); this.elems = []; this.crumbs = "…"; this.unread = "";
    this.links = m ? linksOf(m) : [];
    if (m?.id !== this.commentsFor) { this.comments = null; this.commentsFor = ""; }
    if (!m) return true;
    // A Resource or a file shown as a note: nothing in the outline to read for it.
    if (!isOutlineNote(m)) {
      this.crumbs = m.id.startsWith(RESOURCE_NOTE) ? "a Resource · not a note in the outline" : m.id.startsWith(UNSENT_NOTE) ? "an unsent draft · read here, never written" : "a file";
      // A Resource's text takes comments (PIE-650): its threads live in the outline, so they are read for it too.
      if (m.resource) void this.loadComments(host);
      return true;
    }
    // Lists carry title, properties and revision only; the surface fetches the whole note.
    if (m.partial) this.readWhole(host); else this.settleUnsent(m, host);
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
      if (full) { this.msg = this.rereadNote(full); this.links = linksOf(full); this.settleUnsent(full, host); }
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
    this.innerFrame = host?.innerFrame;
    const view = host ? withFigureBoard(host.ctx.board, () => host.redraw(), () => this.renderOn(w, h, host)) : this.renderOn(w, h);
    if (!this.previewPoint() || this.listPreview.rect || this.editing) this.keepCurrent(host);
    return this.withPlacementMenu(view, w, h, "reader");
  }

  private renderOn(w: number, h: number, host?: SurfaceHost): SurfaceView {
    this.boxRect = null;
    this.listPreview.rect = null;
    this.besideRect = null;
    this.splitDrawn = [];
    this.attachmentTiles["edit-preview"].sync(this.draft?.preview ? this.editPreview : null, this.attachmentTileHost("edit-preview", host));
    this.attachmentTiles.comment.sync(this.session, this.attachmentTileHost("comment", host));
    this.attachmentTiles["list-preview"].sync(this.previewPoint() && !host?.hasWiredPreview?.() ? this.listPreview : null, this.attachmentTileHost("list-preview", host));
    this.attachmentTiles.sources.sync(this.sourcesMode, this.attachmentTileHost("sources", host));
    if (this.replyLinks) return this.renderBeside(w, h, host, (cols, rows, row, col) => {
      const mode = this.replyLinks!;
      mode.rect = { x: col, y: row, w: cols, h: rows };
      const data = mode.group === "thread" ? threadRows(mode.thread, mode.unfolded)
        : linkRows(mode.data, { shut: new Set(), kinds: new Set(), backlinks: DEFAULT_BACKLINK_VIEW_OPTIONS, only: new Set([mode.group]) });
      if (mode.truncated && mode.group === "children" && data[0]?.kind === "group") data[0].note = "first 1000 replies";
      mode.rowsAt = data;
      mode.selected = Math.min(mode.selected, Math.max(0, data.length - 1));
      const drawn = data.map((r, i) => linkRowLines(r, { cols, selected: i === mode.selected, focused: true, lines: this.lastLook?.values["rows.lines"] }));
      const flat = drawn.flatMap((lines, i) => lines.map(text => ({ text, i })));
      const first = drawn.slice(0, mode.selected).reduce((n, lines) => n + lines.length, 0);
      const last = first + (drawn[mode.selected]?.length ?? 1);
      mode.top = Math.max(0, Math.min(mode.top, flat.length - (rows - 1)));
      if (first < mode.top) mode.top = first;
      else if (last > mode.top + rows - 1) mode.top = Math.min(first, last - rows + 1);
      const shown = flat.slice(mode.top, mode.top + rows - 1);
      mode.drawnItems = shown.map(r => r.i);
      let title = "THREAD";
      mode.controls = REPLIES_CONTROLS.map(action => {
        const from = width(title) + 1;
        title += ` [${REPLIES_KEYS.find(row => row.action === action)!.label}]`;
        return { from, to: width(title), action };
      });
      return { lines: [pad(title + (mode.truncated ? " · cut short" : ""), cols), ...shown.map(r => r.text)] };
    });
    // A revision compare (PIE-1433): beside the note as THREAD is (the attached surface's split), the note as it is now beside it.
    // A comment being written stays where it is on the note's side (a split one as a popup there), the keys its own
    // until a click in the compare (revisionKeys).
    const rv = this.revisionMode;
    if (rv && rv.blockId === this.msg?.id) return this.renderBeside(w, h, host, (cols, rows, row, col) => {
      rv.rect = { x: col, y: row, w: cols, h: rows };
      const d = drawRevision(rv.view, cols, rows);
      rv.controls = d.controls; rv.body = d.body;
      return { lines: d.lines };
    }, undefined, (cols, rows) => this.renderReading(cols, rows, host, this.session?.place === "tile" ? null : this.composing(host)));
    const sm = this.sourcesMode;
    if (sm?.place === "inline") return this.renderComment(w, h, host);
    if (sm && sm.place !== "tile") {
      const writing = this.session?.place === "tile" ? null : this.composing(host);
      const floating = sm.place === "floating" || sm.place === "popup";
      if (!floating) {
        const over = writing && (writing.cs.place === "floating" || writing.cs.place === "popup") ? writing : null;
        const v = this.renderBeside(w, h, host,
          (cols, rows, row, col) => this.renderSources(cols, rows, row, col), "sources",
          (cols, rows) => over ? this.renderReading(cols, rows, host, null) : this.renderComment(cols, rows, host));
        return over ? this.overComposer(v, w, h, over, over.cs.place === "floating" ? "floating" : "popup", host?.focused !== false) : v;
      }
      const v = this.renderComment(w, h, host);
      const rect = attachedRect(sm.place, w, h, { frame: this.innerFrame, min: { cols: 24, rows: 10 }, moved: sm.float }, (cols, rows, fill) => {
        const drawn = drawSources(sm.panel, cols - 2, Date.now());
        return { cols: fill ? cols : drawn.cols + 2, rows };
      });
      sm.frame = rect;
      sm.room = this.innerFrame ? { w: this.innerFrame.cols, h: this.innerFrame.rows, col: this.innerFrame.col, row: this.innerFrame.row } : { w, h };
      const side = this.renderSources(rect.cols - 2, rect.rows - 2, rect.row + 1, rect.col + 1);
      const lines = drawAttachedFloat(v.lines, w, h, rect, sm.place === "floating" ? "sources · ≡ move" : "sources", this.modes.active(sm), this.lastLook?.values,
        (canvas, dx, dy) => side.lines.forEach((line, i) => canvas.text(rect.col + 1 + dx, rect.row + 1 + i + dy, line, rect.cols - 2)), sm.place === "floating", this.innerFrame, v.frame);
      // Both attachments are painted; the one holding the keys is the last layer.
      return writing && !this.modes.active(sm) && (writing.cs.place === "floating" || writing.cs.place === "popup")
        ? this.overComposer({ ...v, lines, frame: this.innerFrame }, w, h, writing, writing.cs.place, host?.focused !== false) : { ...v, lines, frame: this.innerFrame, placements: [] };
    }
    const p = this.previewPoint();
    if (p && !this.draft && !this.session) return this.renderListPreview(w, h, host);
    return this.renderComment(w, h, host);
  }

  listPreviewView(w: number, h: number, host?: SurfaceHost, row = 0, col = 0): SurfaceView | null {
    const p = this.previewPoint(), m = this.msg;
    if (!p || !m) return null;
    this.listPreview.rect = { row, col, cols: w, rows: h };
    const { lines } = this.foldsIn(m);
    const start = (lines[p.line] ?? 0) + 1, end = (lines[p.end - 1] ?? start) + 1;
    const links: Link[] = [];
    const hooks = this.bodyHooks(m, lines, this.docEnv(w, host, 8), this.src, links);
    const chip = host?.attachment === "list-preview" && host.hasWiredPreview?.() ? "" : `[${this.listPreview.place} ▸]`;
    const title = pad(`Children · ${p.text.replace(/^\[.\]\s+/, "")}`, Math.max(0, w - chip.length)) + fg(C.lcyan) + chip + RESET;
    const body = this.listEditor.field ? this.listEditor.fieldDraw(w).lines : hooks.spanPreview(start, end, w);
    if (this.listEditor.field) this.listEditor.remapEditor(col, row + 1 - this.listPreview.top);
    const raw = extractLinks(body);
    const initial: Doc = { lines: raw.lines, links: raw.ranges, images: [], media: [], heads: [], trims: new Map(), blocks: [], source: raw.lines.map(() => 0) };
    const { doc, picks } = this.pickerRows(initial, links, w);
    this.listPreview.max = Math.max(0, doc.lines.length - Math.max(0, h - 1));
    this.listPreview.top = Math.min(this.listPreview.top, this.listPreview.max);
    const top = this.listPreview.top;
    const spans = doc.links.filter(r => r.line >= top && r.line < top + h - 1);
    this.previewHits = spans.map(r => ({ row: row + r.line - top + 1, from: col + r.from, to: col + r.to, link: links[r.n]! }));
    for (const [i, r] of (picks?.rows ?? []).entries()) this.previewHits.push({ row: row + r - top + 1, from: col, to: col + w, link: { role: "task", choice: i } });
    this.elems = this.elems.filter(e => e.previewLine === undefined);
    this.elems.push(...this.elementsOf(doc, links, [], [], [], [], row + 1 - top, [], 0).map(e => ({ ...e, from: e.from - this.bx + col, to: e.to - this.bx + col, previewLine: start })));
    this.keepCurrent(host);
    return { lines: [title, ...doc.lines.slice(top, top + Math.max(0, h - 1))] };
  }

  async editListPreview(host: SurfaceHost, actor: Actor, text?: string) {
    const p = this.previewPoint(), m = this.msg;
    if (!p || !m) throw new ActionRefused("select an item in a preview list first");
    const { lines } = this.foldsIn(m), all = m.text.split("\n");
    const a = lines[p.line]! + 1, b = lines[p.end - 1]! + 1;
    const observed = all.slice(a, b).join("\n"), start = all.slice(0, a).join("\n").length + 1;
    const write = async (replacement: string) => {
      await this.patchSource(m.id, m.revision!, observed, replacement, start, host, actor);
      this.sourceHistory.push({ block: m.id, edits: [{ line: a, before: observed, after: replacement }], patch: { start }, by: partyOf(actor), context: m.id });
      this.noteAgent(actor, "edited list children");
    };
    if (text !== undefined) { await write(text); host.redraw(); return { saved: true }; }
    if (actor.kind === "agent") throw new ActionRefused("give text= to patch the children; opening their editor is the person's");
    this.listPreview.top = 0;
    await this.listEditor.edit("children", observed, [], false, `list-children:${m.id}:${p.key}`, write, { redraw: () => host.redraw() });
    this.modes.push({ name: "list-preview", of: this.listEditor, word: "children", noun: "the children edit", holdsKeys: true,
      editing: () => !!this.listEditor.field, covers: () => false, rows: () => null,
      ended: () => !this.listEditor.field,
      key: k => { const intent = this.listEditor.intent(k); if (intent) void this.runKey("list.preview.field", intent, host); return true; },
      click: (x, y) => {
        const r = this.listPreview.rect;
        if (!r || x < r.col || x >= r.col + r.cols || y <= r.row || y >= r.row + r.rows) return undefined;
        const field = this.listEditor.fieldDraw(r.cols);
        this.listEditor.remapEditor(r.col, r.row + 1 - this.listPreview.top);
        const hit = field.hits.find(h => h.row === y - r.row - 1 + this.listPreview.top && x >= r.col + h.from && x < r.col + h.to);
        if (hit) void this.runKey("list.preview.field", hit.args, host);
        else { this.listEditor.begin({ col: x, row: y }); this.listEditor.release(); }
        host.redraw(); return true;
      },
      press: (x, y, _host, drag) => { if (drag) this.listEditor.extend({ col: x, row: y }); else this.listEditor.begin({ col: x, row: y }); host.redraw(); return true; },
      leave: async () => { await this.listEditor.input("cancel"); return { left: "nothing" }; },
      unsaved: () => this.listEditor.unsaved(), keep: () => this.listEditor.keep(),
      hint: () => "children · Enter/ctrl+s save · Esc keeps", state: () => "editing children", describe: () => ({ line: a + 1, endLine: b }),
    });
    if (actor.kind === "user") host.enterMode?.();
    host.redraw(); return { editing: true, line: a + 1, endLine: b };
  }

  async listPreviewField(a: { op: string; value?: string; n?: number }, host: SurfaceHost) { await this.listEditor.input(a.op, a.value, a.n); host.redraw(); return { editing: !!this.listEditor.field }; }

  listPreviewTile(w: number, h: number, host: SurfaceHost): SurfaceView | null {
    if (this.listPreview.place !== "tile") return null;
    const v = this.listPreviewView(w, h, host);
    return v && this.withPlacementMenu(v, w, h, "list-preview");
  }

  private renderListPreview(w: number, h: number, host?: SurfaceHost): SurfaceView {
    const place = this.listPreview.place;
    if (place === "tile" || host?.hasWiredPreview?.()) return this.renderComment(w, h, host);
    if (place === "inline") return this.renderComment(w, h, host);
    if (place === "split") return this.renderBeside(w, h, host,
      (cols, rows, row, col) => this.listPreviewView(cols, rows, host, row, col)!, "list-preview", (cols, rows) => this.renderComment(cols, rows, host));
    const v = this.renderComment(w, h, host);
    const rect = attachedRect(place, w, h, { frame: this.innerFrame, moved: this.listPreview.float });
    const side = this.listPreviewView(rect.cols - 2, rect.rows - 2, host, rect.row + 1, rect.col + 1)!;
    return { ...v, frame: this.innerFrame, lines: drawAttachedFloat(v.lines, w, h, rect, "list children", false, this.lastLook?.values,
      (canvas, dx, dy) => side.lines.forEach((l, i) => canvas.text(rect.col + 1 + dx, rect.row + i + 1 + dy, l, rect.cols - 2)), true, this.innerFrame, v.frame), placements: [] };
  }

  private renderComment(w: number, h: number, host?: SurfaceHost): SurfaceView {
    if (this.replyParent && this.draft) return this.renderSplit(w, h, host, { d: this.draft, f: this.replyFrame(host) });
    // A comment written split (PIE-770): the reader's rect shared, the note in one part and the composer in the other.
    const writing = this.composing(host);
    // In a tile of its own (PIE-846) the comment (or the thread list) is drawn there and the note whole here; the host is
    // asked for the tile once (it opens after this frame); with no tile to be in, a comment is drawn split.
    const cs = this.session;
    if (cs?.place === "tile") return this.renderReading(w, h, host, null);
    const split = writing?.cs.place === "split" || writing?.cs.place === "tile";
    return split && w >= SPLIT_MIN_W && h >= SPLIT_MIN_H ? this.renderSplit(w, h, host, writing!) : this.renderReading(w, h, host, writing);
  }

  /** The note as the reader draws it (with its header image), and a floating or popup composer over it (PIE-770). */
  private renderReading(w: number, h: number, host: SurfaceHost | undefined, writing: ReturnType<NoteSurface["composing"]>): SurfaceView {
    const hero = this.heroOf(w, h, host);
    this.hero = hero && { line: hero.line, full: hero.box.rows, pinned: hero.look.scroll === "pinned", over: hero.look.title === "over", max: Math.floor(h / 2), picture: hero.box.rows };
    let v = this.renderNote(w, h, host);
    const shown = this.drawn?.heroRows ?? 0;
    if (hero && shown) {
      const cut = this.hero?.pinned ? 0 : Math.min(this.scroll, hero.box.rows), lines = Array.from({ length: shown }, () => "");
      if (!hero.placement && hero.loading) lines[shown >> 1] = dim(pad(`  ◌ header · ${hero.name} · loading…`, w));
      // A drag going on says what it will write (PIE-1361), on the header's bottom row.
      const dn = this.heroDrag?.now;
      if (dn) lines[shown - 1] = fg(C.yellow) + pad(`  ${dn.height !== undefined ? `↕ ${dn.height} rows` : `✥ focus ${dn.focus!.x},${dn.focus!.y}`} · let go to write it on the hero line`, w) + RESET;
      const above = hero.placement?.row ?? 0;
      const was = this.heroPlaced?.line === hero.line ? this.heroPlaced.p : null;
      const held = (this.heroDrag?.now || (!hero.placement && !hero.loading && !cut)) && was;
      const p = held ? { ...held, rows: Math.max(1, Math.min(h, hero.box.rows) - cut - held.row) } : hero.placement && inWindow(hero.placement, cut + above, Math.min(h, hero.box.rows - cut) - above, above);
      if (!held && p && !cut) this.heroPlaced = { line: hero.line, p };
      v = { ...v, headerBand: v.headerBand && { ...v.headerBand, row: shown }, lines: [...lines, ...v.lines], gutter: v.gutter?.map(g => ({ ...g, row: g.row + shown })), placements: [...(p ? [p] : []), ...(v.placements ?? []).map(x => ({ ...x, row: x.row + shown }))] };
    }
    // A split that does not fit shares the popup path.
    return writing && writing.cs.place !== "inline" ? this.overComposer(v, w, h, writing, writing.cs.place === "split" || writing.cs.place === "tile" ? "popup" : writing.cs.place, host?.focused !== false) : v;
  }

  /**
   * A floating composer beside its passage (under it when it fits, else over it), or a popup in the middle of the
   * reader with the passage quoted: laid over the note's rows `v`, in the reader's `w` × `h` cells under its header
   * image. A picture under the box isn't drawn while it's there.
   */
  private overComposer(v: SurfaceView, w: number, h: number, c: NonNullable<ReturnType<NoteSurface["composing"]>>, place: "floating" | "popup", focused: boolean): SurfaceView {
    const heroRows = this.drawn?.heroRows ?? 0;
    const lines = this.innerFrame ? v.lines : v.lines.slice(heroRows), room = Math.max(lines.length, h - heroRows);
    let box!: ComposerBox;
    this.boxRect = attachedRect(place, w, room, {
      frame: this.innerFrame && { ...this.innerFrame, row: this.innerFrame.row - heroRows },
      moved: c.cs.float, passage: this.composerRows, from: this.drawn?.top ?? 0,
      to: Math.min(room, (this.drawn?.top ?? 0) + (this.drawn?.room ?? room)), col: (this.drawn?.bx ?? 1) + 2,
    }, (cols, rows, fill) => {
      box = composerBody(c.d, c.f, place === "floating" && !fill ? Math.min(cols, 72) : cols, rows, fill);
      return { cols: box.width, rows: box.lines.length + 2 };
    });
    const { row, col } = this.boxRect;
    if (place === "floating" && this.sourcesMode) c.cs.float ??= this.boxRect;
    this.boxRoom = this.innerFrame ? { w: this.innerFrame.cols, h: this.innerFrame.rows, col: this.innerFrame.col, row: this.innerFrame.row - heroRows } : { w, h: room };
    const painted = drawAttachedFloat(lines, w, room, this.boxRect, place === "floating" ? "≡ move" : "", focused, this.lastLook?.values, (canvas, dx, dy) => {
      box.lines.forEach((line, y) => canvas.text(col + 1 + dx, row + 1 + y + dy, line, box.width - 2));
    }, place === "floating", this.innerFrame && { ...this.innerFrame, row: this.innerFrame.row - heroRows }, this.innerFrame ? { ...(v.frame ?? { col: 0, row: 0, cols: w, rows: h }), row: (v.frame?.row ?? 0) - heroRows } : undefined);

    placeBox(c.d, box, row, col);
    const under = (p: Placement) => p.row < heroRows + row + box.lines.length + 2 && p.row + p.rows > heroRows + row && p.col < col + box.width && p.col + p.cols > col;
    return { ...v, frame: this.innerFrame, lines: this.innerFrame ? painted : [...v.lines.slice(0, heroRows), ...painted], placements: [...(v.placements ?? []).filter(p => p.row < heroRows || !focused && !under(p)), ...previewPictures(c.d, row + 1, row + 1 + box.lines.length).map(p => ({ ...p, row: p.row + heroRows }))] };
  }

  /**
   * A comment written split (PIE-770): the reader's own rect shared, the note on the left and the composer on the
   * right when the reader is wide (SPLIT_SIDE_MIN), else the note on top and the composer under it.
   */
  private renderSplit(w: number, h: number, host: SurfaceHost | undefined, c: { d: Draft; f: EditFrame }): SurfaceView {
    return this.renderBeside(w, h, host, (cols, rows, row, col) => {
      const box = composerBox(c.d, c.f, cols, rows, true);
      placeBox(c.d, box, row - (this.drawn?.heroRows ?? 0), col);
      return { lines: box.lines, placements: previewPictures(c.d, row, rows) };
    }, this.session?.composer === c.d ? "comment" : undefined);
  }

  private renderBeside(w: number, h: number, host: SurfaceHost | undefined, draw: (cols: number, rows: number, row: number, col: number) => SurfaceView, target?: "comment" | "sources" | "list-preview" | "edit-preview", read?: (cols: number, rows: number) => SurfaceView): SurfaceView {
    const rect = attachedRect("split", w, h, { split: target ? this.splits[target] : {}, ...(target === "list-preview" ? { rows: 12 } : {}) });
    const beside = rect.col > 0;
    if (beside) {
      const cw = rect.cols, nw = rect.col - 1;
      if (target) this.splitDrawn.push({ target, beside: true, w, h, edge: nw });
      this.besideRect = { x: rect.col, y: rect.row, w: rect.cols, h: rect.rows };
      const v = (read ? read(nw, h) : this.renderReading(nw, h, host, null)), side = draw(cw, h, 0, nw + 1);
      return { ...v, lines: Array.from({ length: h }, (_, i) => pad(v.lines[i] ?? "", nw) + RESET + (target ? fg(C.dark) + "│" + RESET : " ") + (side.lines[i] ?? "")), placements: [...(v.placements ?? []), ...(side.placements ?? [])] };
    }
    const ch = rect.rows, nh = Math.max(0, rect.row - (target ? 1 : 0));
    if (target) this.splitDrawn.push({ target, beside: false, w, h, edge: nh });
    this.besideRect = { x: 0, y: nh + (target ? 1 : 0), w, h: ch };
    const v = (read ? read(w, nh) : this.renderReading(w, nh, host, null)), side = draw(w, ch, nh + (target ? 1 : 0), 0);
    const top = v.lines.slice(0, nh);
    while (top.length < nh) top.push("");
    return { ...v, lines: [...top, ...(target ? [fg(C.dark) + "─".repeat(w) + RESET] : []), ...side.lines], placements: [...(v.placements ?? []).filter(p => p.row < nh), ...(side.placements ?? [])] };
  }

  /**
   * The header image this render draws above the note (PIE-532), or null: the note's first `[layout::hero]` image, when
   * the host draws Kitty graphics, nothing covers the note and the pane is tall enough to give it rows (at most a third
   * of the pane, or `[height::…]`, never more than half). The full width, the whole image when it fits; taller, cropped
   * to fill (`[fit::contain]`: shown whole, centred). Dimmed as every image is (`[dim::…]`). While the file loads its
   * rows (the cap's) are kept dark, so nothing flashes when it arrives; an image shorter than the cap then takes
   * fewer rows, and the note moves up once.
   */
  private heroOf(w: number, h: number, host?: SurfaceHost): { line: number; box: ReturnType<typeof heroBox>; placement: Placement | null; loading: boolean; name: string; look: ReturnType<typeof heroLook> } | null {
    const m = this.msg;
    if (!m || m.partial || !host?.ctx.graphics || this.modes.covers || this.panel?.full || h < HERO_MIN_PANE) return null;
    const values = this.lookAt(m, w, host).values;
    // The note's own hero line, the first one (PIE-1361): nothing else names a header picture.
    const found = this.heroRef(m);
    if (!found) return null;
    // A drag going on draws where it is (heroDrag), before its one save.
    const now = this.heroDrag?.line === found.line ? this.heroDrag.now : undefined;
    const ref = now ? { ...found, spec: { ...found.spec, ...(now.height !== undefined ? { height: now.height, heightShare: undefined } : {}), ...(now.focus ? { focus: now.focus } : {}) } } : found;
    const look = heroLook(ref.spec, values);
    const bounds = look.bleed === "full" ? host.heroBounds : undefined;
    const cols = look.bleed === "full" ? bounds?.cols ?? w : Math.max(1, w - this.bx - this.bxRight);
    const entry = media(ref.path, ref.spec.kind === "video" ? "video" : "img");
    if (entry.state === "error") return null;
    const cap = Math.max(1, Math.min(look.height ?? Math.floor(h * (look.heightShare ?? 1 / 3)), Math.floor(h / 2)));
    const name = ref.path.split("/").pop() ?? ref.path;
    const [cw, chh] = cellOf(host);
    // Its rows come from its size, read from its header before it's decoded: the note never moves when it arrives.
    if (entry.state === "loading") {
      const box = entry.width && entry.height ? heroBox({ width: entry.width, height: entry.height }, look, cols, cap, cw, chh) : { col: 0, cols: w, rows: cap };
      return { line: ref.line, box, placement: null, loading: true, name, look };
    }
    const box = heroBox(entry, look, cols, cap, cw, chh);
    // A drag going on scales nothing: the picture drawn when it began stands in (renderReading), the terminal scaling it.
    if (now) return { line: ref.line, box, placement: null, loading: false, name: ref.path.split("/").pop() ?? ref.path, look };
    const [placement] = imagePlacements([{ line: 0, media: entry, look: look.pixels, ...box }], 0, cw, chh);
    return { line: ref.line, box, placement: placement ? { ...placement, key: `hero:${placement.key}`, col: placement.col + (bounds?.col ?? (look.bleed === "full" ? 0 : this.bx)), row: bounds?.row ?? 0, rows: placement.rows - (bounds?.row ?? 0) } : null, loading: false, name, look };
  }

  /**
   * The reader's sticky header (its title, summary line, byline with the comment count, and crumbs; or a host's own
   * header, the BBS message header, then the summary line): the rows every reading render starts with, and the row the
   * summary is on with its links. One builder: the reading render and a digest's host (stickyHeader) both draw it.
   */
  private headerBlock(m: Msg, w: number, host: SurfaceHost | undefined, src: Source | null): HeaderBlock {
    const gx = this.printed || host?.externalGutter !== undefined ? 0 : this.gutterWidth();
    w = Math.max(1, w - gx);
    // The Work ID heads the title line (PIE-809), not this one.
    const meta = [authorName(m.author), bbsDate(m.updatedAt)].filter(Boolean).join(" · ");
    const open = this.comments?.filter(c => c.open).length ?? 0;
    // The way in to a comment on the whole note (PIE-846), by mouse: the same as C with nothing selected.
    const sourcesOn = !this.printed && this.hasSources(m);
    const commentOn = !this.printed && (isOutlineNote(m) || (m.resource && !m.resource.uncommentable));
    const chip = (sourcesOn ? `${fg(C.dark)} · ${fg(C.lcyan)}${SOURCES_CHIP}` : "") + (commentOn ? `${fg(C.dark)} · ${fg(C.lcyan)}${COMMENT_CHIP}` : "");
    // Marks only (PIE-873): the margin's off mode said where the comments are counted, so it's found and its way back is.
    const n = this.comments?.length ?? 0, off = this.marginMode === "off" && !this.printed;
    // The chip says what's drawn (PIE-1255), in the mode's own words; its hover, what each mode does.
    const mode = MARGIN_MODE_WORDS[off ? "off" : this.marginMode].chip;
    let said = !this.comments?.length ? "" : `${fg(C.dark)} · ${fg(open ? C.yellow : C.dark)}■ ${n} comment${n === 1 ? "" : "s"} · ${mode} (M)`;
    // Detail's summary line: the chosen keys only; everything else is in the property panel (`i`).
    // A value that names a block, a page or a Work ID reads as a link, and a click opens it.
    const own0 = host?.header, { text: summary, line: summaryLine, links: summaryLinks } = this.summaryView(m, src, own0 ? C.lgreen : C.dark);
    const count = this.rows(m).length;
    // A host's own header (the BBS message header) stands in for the title, byline and crumbs; the
    // summary line comes after it, so its row is counted rather than assumed.
    const own = host?.header?.(m, w, this.headerInfo(m, count));
    const propsText = !this.panel && count ? `i ${count} propert${count === 1 ? "y" : "ies"}` : "";
    const props = propsText ? `${fg(C.dark)} · ${propsText}` : "";
    if (own) {
      const summaryRows = summary ? [pad(fg(C.lgreen) + summaryLine + (propsText ? fg(C.dark) + ` · ${propsText}` : ""), w) + RESET] : [];
      return { rows: [...own, ...summaryRows].map(l => " ".repeat(gx) + l), summary, summaryRow: own.length, summaryLinks: summary ? summaryLinks.map(l => ({ ...l, from: l.from + gx, to: l.to + gx })) : [], title: null, own: true };
    }
    // The note's title leads the header (PIE-657): the crumbs are an eyebrow above it, dim; the title is the one bright
    // bold line (brighter in the focused tile, a step down in the others), then one dim line holding everything else.
    // Keep normal cell width: a terminal's sizing probe cannot prove its font will scale instead of spacing the letters.
    // A note with a Work ID shows it first, in the accent (PIE-809: `HOME-011 · <title>`), said once (outline-core's rule).
    // The rows the note leaves out (PIE-1319). `ep0ch show` (printed) keeps them all: its first line is what a script reads.
    // Zoomed into a part (PIE-780), the part fills the tile: one row above it says what it is and how back goes.
    // The tile can set its own (PIE-1248): full, the title alone on one line, or none; one answer, headerShown.
    const omit = this.printed ? { crumbs: false, title: false, byline: false, oneLine: false } : this.zoom ? { crumbs: false, title: true, byline: true, oneLine: false } : headerShown(m, host?.tileHeader);
    // The rows above the title: the crumbs, unless the note leaves them out.
    const above = omit.crumbs ? 0 : 1;
    // The one name (board's headedTitle); its two parts colour it, the ID in the accent.
    // A title written on the tile (tile.title) heads it in place of the note's, as its frame and spine say it.
    const written = this.printed ? undefined : host?.tileTitle;
    const named = written ? { workId: null } : workIdTitle(subject(m), prop(m, "work-id")), focused = host?.focused !== false, title = written ?? headedTitle(m);
    // In the theme's heading colour (PIE-809): the theme caps white near the body text's grey, so a white title read as
    // body; the note's top heading is drawn as its headings are.
    const ink = (focused ? fg(C.yellow) : fgRgb(theme().palette[C.yellow]!.map(c => Math.round(c * TITLE_UNFOCUSED)) as unknown as Rgb)) + BOLD;
    const accent = fg(focused ? C.lcyan : C.cyan) + BOLD;
    const lead = `${fg(C.dark)}${meta}`;
    // The summary's values follow the byline on the same line; its links shift by what comes before them.
    const before = `${meta}${propsText ? ` · ${propsText}` : ""}${summary ? " · " : ""}`;
    const merged = `${lead}${props}${fg(C.dark)} · ${summaryLine}${said}`;
    // One line while it fits; in a narrow tile the summary (whose values are links) goes to a line of its own rather than
    // being cut off the end of the byline.
    const apart = !!summary && width(`${before}${summary}`) > w;
    // Narrower still, the property count leads the next line, whole (PIE-1302: it was cut though that line had room),
    // with the summary after it while that fits, else on a line of its own.
    const propsApart = !!propsText && width(`${meta} · ${propsText}`) > w;
    const shared = propsApart && !!summary && width(`${propsText} · ${summary}`) <= w;
    const metaRows = propsApart
      ? [`${lead}${said}`, fg(C.dark) + propsText + (shared ? ` · ${summaryLine}` : ""), ...(summary && !shared ? [fg(C.dark) + summaryLine] : [])]
      : !summary ? [`${lead}${props}${said}`] : apart ? [`${lead}${props}${said}`, fg(C.dark) + summaryLine] : [merged];
    // The summary's row among them, and the cells before it on that row.
    const summaryAt = !apart ? 0 : propsApart && !shared ? 2 : 1, summaryFrom = !apart ? width(before) : shared ? width(`${propsText} · `) : 0;
    // Marks only in a narrow tile: the short form, so its way back (M, or a click) is still on screen whole.
    if (said && width(metaRows[0]!) > w) {
      const short = `${fg(C.dark)} · ${fg(open ? C.yellow : C.dark)}■ ${n} · ${mode} (M)`;
      metaRows[0] = pad(metaRows[0]!.slice(0, metaRows[0]!.length - said.length), Math.max(0, w - width(short))) + short;
      said = short;
    }
    // The count ends the first byline row: a click on it cycles the margin (M), where it's drawn whole.
    const saidTo = width(metaRows[0]!), marginChip = said && !this.printed && saidTo <= w ? { row: -1, from: saidTo - width(said) + 3, to: saidTo } : undefined;
    // The [comment] chip ends the first byline row, where it fits whole: never at the cost of the byline itself.
    const chipped = !!chip && width(metaRows[0]! + chip) <= w;
    if (chipped) metaRows[0] += chip;
    const links = !summary ? [] : summaryLinks.map(l => ({ ...l, from: l.from + summaryFrom, to: l.to + summaryFrom })).filter(l => l.from < w);
    // The whole title, wrapped onto as many lines as it needs (PIE-815: a question's title is the question; cutting it
    // here was the bug). The Work ID keeps the accent at the start of the first line.
    // The tile's title-only header keeps it to one line, cut with an ellipsis.
    const lines = width(title) <= w ? [title] : omit.oneLine ? [ellipsize(title, w)] : wrap(title, w);
    const titled = lines.map((l, i) => (i === 0 && named.workId && l.startsWith(`${named.workId} · `) ? pad(`${accent}${named.workId}${fg(C.dark)} · ${ink}${l.slice(named.workId.length + 3)}`, w) : ink + pad(l, w)) + RESET);
    const wholeMarks: NonNullable<HeaderBlock["wholeMarks"]> = [];
    // A folded whole-note thread's [+] is after the title, never in the gutter (PIE-1255: a row of them there pushed
    // the body over); the ones that don't fit go on a row of their own under it, so none is lost in a narrow tile.
    // The title-only header (PIE-1248) is one row: the whole-note threads are the tile menu's comments row there.
    if (!this.printed && !omit.title && !omit.oneLine) {
      let col = width(lines.at(-1) ?? ""), row = titled.length - 1, n = 0;
      const put = () => { if (n) titled[row] = pad(titled[row]!.replace(/ *\x1b\[0m$/, "") + fg(C.yellow) + ` [+]`.repeat(n) + RESET, w); };
      for (const c of (this.comments ?? []).filter(c => isWholeNote(c) && !this.threadShown(c.id))) {
        if (col + 4 > w && (col > 0 || n > 0)) { put(); titled.push(""); lines.push(""); row++; col = 0; n = 0; }
        wholeMarks.push({ thread: c.id, row: above + row, from: col + 1, to: Math.min(w, col + 4) });
        col += 4; n++;
      }
      put();
    }
    const titleControls: NonNullable<HeaderBlock["titleControls"]> = [];
    if (!this.printed && !this.raw && !omit.title && !omit.oneLine && isOutlineNote(m)) {
      for (const decoration of decorationsOf(m, src).filter(d => d.place === "title")) {
        const tags: Link[] = [];
        const drawn = decorationRows(decoration, w, {
          markdown: (text, width) => wrap(text, width),
          press: (act, text) => tagged(tags, { role: "control", label: text, press: { act, block: m.id, line: 0 } }, text),
        });
        const control = extractLinks(drawn);
        for (let i = 0; i < control.lines.length; i++) {
          const text = control.lines[i]!, last = titled.length - 1;
          let row = last, col = width(titled[last]!.trimEnd().replace(/ *\x1b\[0m$/, "")) + 1;
          if (col + width(text) > w) { row++; col = 0; titled.push(""); lines.push(""); }
          titled[row] = pad(titled[row]!.replace(/ *\x1b\[0m$/, "").trimEnd() + " ".repeat(col ? 1 : 0) + text, w) + RESET;
          for (const r of control.ranges.filter(r => r.line === i)) titleControls.push({ row: row + above, from: gx + col + r.from, to: gx + col + r.to, link: tags[r.n]! });
        }
      }
    }
    const subtitle = omit.oneLine ? undefined : subtitleOf(m);
    const subRows = subtitle ? [fg(C.dark) + pad(printable(subtitle, " "), w) + RESET] : [];
    const titleRows = omit.title ? [] : [...titled, ...subRows];
    // The byline's row: after the crumbs and the title, as many of them as are drawn.
    const first = this.printed ? lines.length + subRows.length : above + titleRows.length;
    // `ep0ch show` prints it too, title first as it always did: its first line is what an agent or a script reads.
    const crumbs = this.zoom && !this.printed ? this.zoomBar(m, w) : fg(C.dark) + pad(this.crumbs, w) + RESET, metas = metaRows.map(r => pad(r, w) + RESET);
    const rows = this.printed ? [...titled, ...subRows, ...metas, crumbs] : [...(omit.crumbs ? [] : [crumbs]), ...titleRows, ...(omit.byline ? [] : metas)];
    // The chip ends the first byline row (the one `said` is on), where it fits in the tile; with no byline, the tile
    // menu (⋯) has the same rows: comment on the whole note, comments, properties, sources.
    const chipTo = chipped ? width(metaRows[0]!) : 0, commentChip = chipped && commentOn && !omit.byline ? { row: first, from: chipTo - width(COMMENT_CHIP), to: chipTo } : undefined;
    const sourcesChip = chipped && sourcesOn && !omit.byline ? { row: first, from: chipTo - (commentOn ? width(` · ${COMMENT_CHIP}`) : 0) - width(SOURCES_CHIP), to: chipTo - (commentOn ? width(` · ${COMMENT_CHIP}`) : 0) } : undefined;
    return { rows: rows.map(l => " ".repeat(gx) + l), titleControls, wholeMarks: wholeMarks.map(l => ({ ...l, from: l.from + gx, to: l.to + gx })), summary: omit.byline ? "" : summary, summaryRow: first + summaryAt, summaryLinks: omit.byline ? [] : links.map(l => ({ ...l, from: l.from + gx, to: l.to + gx })), title: omit.title ? null : { row: this.printed ? 0 : above, rows: lines.length }, ...(this.printed ? { crumbsRow: rows.length - 1 } : omit.crumbs ? {} : { crumbsRow: 0 }), ...(commentChip ? { commentChip: { ...commentChip, from: commentChip.from + gx, to: commentChip.to + gx } } : {}), ...(sourcesChip ? { sourcesChip: { ...sourcesChip, from: sourcesChip.from + gx, to: sourcesChip.to + gx } } : {}), ...(marginChip && !omit.byline ? { marginChip: { ...marginChip, from: marginChip.from + gx, to: marginChip.to + gx, row: first } } : {}) };
  }

  /**
   * The sticky header for a host that draws this surface's digest under a scroll of its own (a river column): the
   * reader's header rows (headerBlock), with the header's backdrop (PIE-598) for `under`, how many of the digest's rows
   * the host has scrolled above it. `links`: the summary line's links by row and cells, for the host's clicks;
   * `placements`: the backdrop's Kitty placements, on these rows. Call it after `digest`, whose layout it reads.
   */
  stickyHeader(m: Msg, w: number, host: SurfaceHost, under: number): { lines: string[]; links: { row: number; from: number; to: number; link: Link }[]; placements: Placement[] } {
    const src = this.use(host);
    this.lookAt(m, w, host);
    const { rows, summaryRow, summaryLinks } = this.headerBlock(m, w, host, src);
    const lines = [...rows];
    const headerRule = rows.length ? this.headerRule(w) : "";
    if (headerRule) lines.push(headerRule);
    const d = this.digested?.m.id === m.id && this.digested.m.revision === m.revision ? this.digested : null;
    this.backdropShown = null;
    const shade = d ? this.heroBackdrop(m, d.doc, d.lines, w, lines.length, host, Math.max(0, under)) : { placements: [], grid: null };
    this.headerSurface(lines, lines.length, w, shade);
    return { lines, links: summaryLinks.map(l => ({ row: summaryRow, from: l.from, to: Math.min(w, l.to), link: l.link })), placements: shade.placements };
  }

  private headerRule(w: number): string {
    const values = this.lastLook?.values, kind = values?.["header.rule"] ?? "none";
    if (kind === "none") return "";
    const glyph = kind === "dots" ? "·" : kind === "heavy" ? "━" : "─";
    return fg(TONE_INDEX[values!["header.rule.tone"]]) + glyph.repeat(w) + RESET;
  }

  /**
   * The header's rows over their backdrop and their surface (PIE-675): the look's `header.bg` at `header.bg.opacity`
   * over the ground, or over the backdrop's colours (cells); a backdrop Kitty draws shows only through cells on the
   * default background, so there the surface yields to it. Capped dark either way (theme.ts surfaceMix).
   */
  private headerSurface(lines: string[], rows: number, w: number, shade: { placements: Placement[]; grid: CellGrid | null }) {
    const v = this.lastLook?.values, role = v?.["header.bg"] ?? "none", share = (v?.["header.bg.opacity"] ?? 0) / 100;
    const own = role !== "none" && share > 0 && !shade.placements.length;
    if (!own && !shade.grid) return;
    const ground = own ? surfaceMix(role, share) : null;
    for (let r = 0; r < rows; r++) {
      const under = shade.grid?.[r];
      const row = under ? (own ? under.map(c => surfaceMix(role, share, c) ?? c) : under) : ground ? [ground] : null;
      if (row?.length) lines[r] = overColours(lines[r]!, w, row);
    }
    return ground ? { row: 0, rows, bg: bgRgb(ground) } : undefined;
  }

  /**
   * The header's backdrop this render draws (PIE-598): the picture that has gone under the header (heroSources), at
   * the step for how far it has gone; in follow mode, a picture still coming in is drawn over the one before it at
   * full, so one fades into the next and the header never drops to plain between them. Kitty: their placements (the
   * one before a layer lower); cells: the colours under each header cell. Kept for describe (`header.backdrop`).
   */
  private heroBackdrop(m: Msg, doc: Doc, noteLines: number[], w: number, rows: number, host: SurfaceHost | undefined, scroll: number): { placements: Placement[]; grid: CellGrid | null } {
    this.backdropShown = null;
    const none = { placements: [], grid: null };
    if (!heroHeaderOn() || !host || rows < 1) return none;
    const mode = heroHeaderMode(), all = this.heroSources(m, doc, noteLines, mode, scroll);
    if (!all.length) return none;
    // The last that has gone under (the first, before any has); in first mode there's only the hero.
    const at = Math.max(0, all.findLastIndex(x => x.gone > 0)), pick = all[at]!, step = heroStep(pick.gone);
    const graphics = !!host.ctx.graphics, cell = cellOf(host);
    const draw = (x: (typeof all)[number], n: number, over: { grid?: CellGrid; z?: number } = {}) => {
      const entry = media(x.path, x.kind);
      return entry.state === "ready" ? backdrop(entry, x.focus, x.dim, n, w, rows, ...cell, graphics, { ...over, look: x.pixels }) : null;
    };
    // The one before stays under it until it's drawn at full (a step or a variant still being made never leaves the
    // header plain, or shows a lower step over nothing).
    const prev = mode === "follow" && at > 0 ? all[at - 1]! : null;
    let under = prev ? draw(prev, HERO_STEPS, { z: -3 }) : null;
    const shade = draw(pick, step, under && "grid" in under ? { grid: under.grid } : {});
    if (shade && shade.step === HERO_STEPS) under = null;
    const before = under ? prev : null;
    const name = (x: { path: string }) => x.path.split("/").pop() ?? x.path;
    this.backdropShown = {
      image: name(pick), line: pick.line + 1, step, of: HERO_STEPS, mode, drawn: !step && !under ? null : !shade && !under ? "making" : graphics ? "kitty" : "cells",
      ...(before && under ? { over: name(before) } : {}), ...(pick.focus ? { focus: pick.focus } : {}),
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
  private heroSources(m: Msg, doc: Doc, noteLines: number[], mode: HeroMode, scroll: number): { path: string; kind: "img" | "video"; focus?: Focus; dim?: number; line: number; gone: number; pixels?: import("../media").Look }[] {
    const all = this.heroPictures(m, doc, noteLines, mode, scroll);
    const values = this.lastLook!.values;
    return all.map(x => {
      const spec = this.imagesIn(m).find(r => r.line === x.line && r.path === x.path)?.spec ?? { kind: x.kind, path: x.path, problems: [] };
      const look = heroLook(spec, values);
      return { ...x, focus: look.focus, dim: look.pixels.dim, pixels: look.pixels };
    });
  }

  /** heroSources' pictures: the hero first, then (follow) the body's. */
  private heroPictures(m: Msg, doc: Doc, noteLines: number[], mode: HeroMode, scroll: number): { path: string; kind: "img" | "video"; focus?: Focus; dim?: number; line: number; gone: number; pixels?: import("../media").Look }[] {
    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    const look = (spec: MediaSpec) => ({ ...(spec.focus ? { focus: spec.focus } : {}), ...(spec.dim !== undefined ? { dim: spec.dim } : {}) });
    const out: ReturnType<NoteSurface["heroSources"]> = [];
    if (this.hero) {
      const ref = this.imagesIn(m).find(x => x.line === this.hero!.line);
      if (ref) out.push({ path: ref.path, kind: ref.spec.kind === "video" ? "video" : "img", ...look(ref.spec), line: ref.line, gone: this.hero.pinned ? 0 : clamp(scroll / Math.max(1, this.hero.full)) });
      if (mode === "first") return out;
    }
    const all = m.text.split("\n"), first = doc.media[0];
    const firstBlock = first && noteLines[first.line] !== undefined && all.slice(1, noteLines[first.line]).every(l => !l.trim()) ? first : undefined;
    const body = mode === "follow" ? doc.media : [doc.media.find(x => x.spec.layout === "hero") ?? firstBlock].filter(x => x !== undefined);
    for (const x of body) {
      const line = noteLines[x.line];
      if (line === undefined || x.spec.kind !== "img" || line === this.hero?.line || out.some(o => o.line === line && o.path === x.path)) continue;
      const im = x.image !== undefined ? doc.images[x.image] : undefined;
      const gone = im ? (scroll - im.line) / Math.max(1, im.rows) : (scroll - x.row) / HERO_RAMP_ROWS;
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
    this.lookAt(m, w, host);
    const covered = this.modes.rows(w, h, host);
    if (covered) return { ...covered, ...(this.draft ? { placements: this.editPreview.place === "tile" ? [] : this.draft.frame?.preview?.placements } : {}), completion: this.draft ? completerOf(this.draft) ?? undefined : undefined, ...(this.draft ? { scroll: elementEdit(this.draft).on ? elementEdit(this.draft).scrollFigure : this.draft.scrollFigure } : {}) };
    if (m.partial) return { lines: [...(host?.header ? host.header(m, w, this.headerInfo(m, 0)) : [fg(C.white) + pad(subject(m), w) + RESET]), this.unread ? fg(C.lred) + pad(`couldn't read the note: ${this.unread}`, w) + RESET : dim("reading the note…"), ...(this.unread ? [dim("it's read again when the door reconnects")] : [])] };
    this.viewKeys = host?.summaryKeys?.(m) ?? null;
    const src = this.use(host);
    // Back and forward (PIE-453): the reader's last row, while it has somewhere to go.
    const foot = this.panel?.full || h <= 3 ? null : historyRow(w, this.peek(-1), this.peek(1), !!host?.overlay);
    if (foot) h -= 1;
    // Each construct the note leaves open, on its line (PIE-669): what is read instead, and how to close it.
    const open = openConstructs(m.text);
    const { rows: headerBlock, summary, summaryRow, summaryLinks, title, own, crumbsRow, commentChip, sourcesChip, marginChip, wholeMarks, titleControls } = this.headerBlock(m, w, host, src);
    // An agent's proposal, opened (PIE-501): its [apply] [dismiss] on a row of their own under the byline.
    const proposalTags: Link[] = [];
    const proposalHead = isOpenProposal(m) ? { row: headerBlock.length, ...extractLinks([pad(fg(C.yellow) + "proposal ·" + proposalControls(m, proposalTags) + fg(C.dark) + (" · " + this.proposalKeys(m.id).replace(/ · $/, "") + (proposalApplies(m) ? "" : " · it can't be applied: its passage was already gone")), w) + RESET]) } : null;
    const head = [
      ...headerBlock,
      ...(proposalHead ? proposalHead.lines : []),
      // A note trashed while it's shown (a proposal dismissed, a card or an ancestor trashed elsewhere: staleOn) says so: it's still readable.
      ...(m.deleted ? [fg(C.lred) + pad(IN_TRASH, w) + RESET] : []),
      ...(this.notice ? [fg(C.yellow) + pad(this.notice, w) + RESET] : []),
    ];
    // A draft put aside on this note (esc twice, a closed screen, the door quitting) says so, with its controls:
    // [diff] [open copy] [dismiss] [take it back]; an old one on an older revision folds into one dim line.
    const unsentHead = this.unsentHead(m, w, head.length);
    head.push(...unsentHead.lines,
      // An opener without a closer (a literal region, PIE-422; a fence, `[[`, `[key::` or component, PIE-669): said.
      ...open.slice(0, OPEN_SHOWN).map(o => fg(C.yellow) + pad(`⚠ ${o.message}`, w) + RESET),
      ...(open.length > OPEN_SHOWN ? [dim(`  and ${open.length - OPEN_SHOWN} more left open`)] : []),
      ...(this.agent ? [fg(C.lmagenta) + pad(`an agent (${agentWords(this.agent.id)}) ${this.agent.did}`, w) + RESET] : []),
      // A focus mark says whose it is, in the ruler's own tint (PIE-423).
      ...(this.focusMark ? [RULER_BG + fg(C.lmagenta) + pad(this.focusMark.line ? `◆ ${this.focusMark.label} · ${this.focusMark.says ?? "the line that links here"}${this.focusMark.by.kind === "agent" ? ` · ${agentLabel(this.focusMark.by)} opened it` : ""} · esc lets go` : this.focusMark.fragment ? `◆ ${this.focusMark.label} · the fragment the link names${this.focusMark.by.kind === "agent" ? ` · ${agentLabel(this.focusMark.by)} followed it` : ""} · esc lets go` : `◆ focus · ${agentLabel(this.focusMark.by)} marked ${this.focusMark.label}`, w).split(RESET).join(RESET + RULER_BG) + RESET] : []),
    );
    if (this.panel?.card) {
      const card = this.panel.card, fields = this.settingFields(m, card.schemas);
      const at = head.length;
      head.push(...card.render(fields, w, Math.min(fields.length + (card.schemas.length > 1 ? card.schemas.length : 0) + 2, Math.max(4, Math.floor((h - head.length) * 0.6))), m.revision));
      for (const r of card.at) this.hits.push({ row: at + r.y, from: 0, to: w, prop: r.n, follow: false });
    } else if (this.panel) {
      const rows = this.rows(m);
      const tokens = tokensOf(m.text, src);
      const info = { origin: head.length, revision: m.revision, summary: this.summary(m).keys, source: this.summary(m).source, scopes: tokens === null ? "loading" as const : tokens.state === "ready" ? "ready" as const : "block" as const, src, text: m.text, look: this.lastLook?.values, values: this.valueRows(m, src) };
      const at = head.length;
      this.panel.origin = at;
      const panelHits = () => { for (const r of this.panel!.at) this.hits.push({ row: at + r.y, from: 0, to: w, prop: r.n, follow: false }, ...(r.target ? [{ row: at + r.y, from: r.from, to: w, prop: r.n, follow: true }] : [])); };
      if (this.panel.full) { const lines = [...head, ...this.panel.render(rows, w, Math.max(2, h - head.length), info)]; panelHits(); return { lines }; }
      const popup = this.panel.field && completionOf(this.panel.field.input) ? COMPLETION_ROWS : 0;
      const ph = Math.min(rows.length + 2 + popup + (info.values.length ? Math.min(info.values.length, 6) + 1 : 0) + (this.panel.note || this.panel.field?.note ? 1 : 0), Math.max(4 + popup, Math.floor((h - head.length) * 0.5)));
      head.push(...this.panel.render(rows, w, ph, info));
      panelHits();
    }
    // The look's margin.y: blank rows above the body (edge rows: never copied), then one blank row between the header
    // and the body (PIE-657); a rule only under the property panel, which it closes.
    const headed = head.length > 0;
    for (let r = 0; r < this.my; r++) head.push("");
    // A note with no header rows at all (PIE-1319: `[header::none]`) starts its body on the first row: no blank, no rule,
    // except once the person has selected words: the row above the body holds the selection's count and toolbar. It
    // comes when the drag ends, so nothing moves under the mouse while it's down (the selection moves with the body).
    if (this.panel || (headed ? !host?.header || head.length + 1 < h : !!this.selection && !this.dragging)) head.push(this.panel ? rule(w) : "");
    const headerRule = headerBlock.length ? this.headerRule(w) : "";
    if (headerRule) head.push(headerRule);
    const top = head.length;
    const laid = this.layOut(m, w, h, head, summaryRow, summary ? summaryLinks : [], host, src);
    const { doc, drawn, picks, controls, body, marks, lines: noteLines } = laid;
    this.positionRows.source = doc.source.map(line => noteLines[line] ?? -1);
    // A growing header must not cover an anchor that was visible; wrapped lines already above it stay there.
    const view = this.position.view;
    if (view && view.row >= this.positionRows.origin && view.row < top) view.row = top;
    this.positionRows.origin = top;
    if (this.hero?.over && title) this.hero.full = Math.max(0, this.hero.full - title.row - title.rows);
    this.positionRows.leading = this.hero?.pinned ? 0 : this.hero?.full ?? 0;
    this.positionRows.settle();
    const whole = new Set((this.comments ?? []).filter(isWholeNote).map(c => c.id));
    // A whole-note thread's mark is on the title's row; a note that leaves its title out (PIE-1319) has it on the body's first.
    const wholeRow = title?.row ?? (own ? 1 : top);
    const gutterRow = (k: Mark) => whole.has(k.thread) ? wholeRow : top + k.row - this.scroll;
    // Its `[ ]` stop is its [+] after the title, while it's folded there; an open one's is its card's own [–] (a control).
    const wholeAt = new Map((wholeMarks ?? []).map(k => [k.thread, k]));
    this.elems = laid.elems.map(e => {
      if (e.kind !== "comment" || !whole.has(e.thread!)) return e;
      const k = wholeAt.get(e.thread!), row = k?.row ?? wholeRow;
      return { ...e, row, ...(k ? { from: k.from, to: k.to } : {}), ruler: [row, row + 1] as [number, number] };
    }).filter(e => e.kind !== "comment" || !whole.has(e.thread!) || wholeAt.has(e.thread!) || !this.threadShown(e.thread!));

    // An opened proposal's [apply] [dismiss] (in the header, so not part of the kept layout): elements and click targets.
    if (proposalHead) {
      const own: Element[] = proposalHead.ranges.map(r => {
        const l = proposalTags[r.n]!, key = `control:proposal:${l.proposal!.op}:${m.id}#0`;
        this.hits.push({ row: proposalHead.row, from: r.from, to: r.to, link: l, elem: key });
        return { key, kind: "control", row: proposalHead.row, from: r.from, to: r.to, ruler: [proposalHead.row, proposalHead.row + 1], label: `[${l.proposal!.op}] this proposal`, link: l };
      });
      this.elems = [...laid.elems, ...own].sort((a, b) => a.row - b.row || a.from - b.from);
    }
    for (const [i, control] of (titleControls ?? []).entries()) {
      const key = `control:title:${m.id}:${i}`;
      this.hits.push({ ...control, elem: key });
      this.elems.push({ ...control, key, kind: "control", ruler: [control.row, control.row + 1], label: control.link.label ?? "run" });
    }
    this.elems.sort((a, b) => a.row - b.row || a.from - b.from);
    if (unsentHead.elems.length) this.elems = [...this.elems, ...unsentHead.elems].sort((a, b) => a.row - b.row || a.from - b.from);
    // The body rows actually shown: none when the header fills the pane (then there's no scroll to show). A header
    // image above it (PIE-532) gives a row back for each row scrolled, so the scroll that has the last body row
    // `extra` rows above the bottom is S ≥ body + extra − (roomFull − (full − S)) while the image shows, and
    // S ≥ body + extra − roomFull once it's gone. End stops first where it's on the bottom edge (extra 0); the
    // furthest scroll is past the end (PIE-622, reader.overscroll: to the middle, by default).
    const pinned = this.hero?.pinned;
    const full = this.hero?.full ?? 0, roomFull = Math.max(0, h - top);
    const roomAt = (s: number) => Math.max(0, roomFull - (pinned ? full : Math.max(0, full - s)));
    const reach = (extra: number) => {
      if (pinned) return Math.max(0, body.length + extra - Math.max(1, roomFull - full));
      const over = body.length + extra - Math.max(1, roomFull);
      return !full || over >= full ? Math.max(0, over) : Math.max(0, Math.ceil((over + full) / 2));
    };
    this.endScroll = reach(0);
    // Never so far that the last body row leaves the view (a short note under a header image).
    this.maxScroll = Math.max(this.endScroll, Math.min(Math.max(0, body.length - 1), reach(overscrollRows(roomFull))));
    if (this.endWant) { this.scroll = this.endWant === "edge" ? this.endScroll : this.maxScroll; this.endWant = null; }
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
    // A card the person just opened comes into view (PIE-1255): spliced in above the row the reader keeps in place (a
    // whole-note card is at the top of the body), it would otherwise open out of sight, until a scroll.
    if (this.revealThread) {
      // Rows went in where the card opened: what was at the top of the view stays at the top, not the line under them.
      if (this.revealFrom !== null) { this.scroll = Math.min(this.revealFrom, this.maxScroll); room = roomAt(this.scroll); }
      const side = laid.margin.cards.find(c => c.thread === this.revealThread);
      const rows = side ? [side.at, side.at + side.rows.length - 1] : controls.filter(c => c.thread === this.revealThread).map(c => c.row);
      if (rows.length) bringIn([top + Math.min(...rows), top + Math.max(...rows) + 2]);
      this.revealThread = null; this.revealFrom = null;
    }
    const markRows = this.focusMark ? this.focusRows(this.focusMark.spec, m, doc, noteLines, top) : null;
    // A followed fragment comes to the top (a line of what's above it kept); an agent's mark only as far as needed.
    if (this.revealMark && markRows) { if (this.focusMark?.fragment || this.focusMark?.line) this.scroll = Math.max(0, markRows[0] - top - Number(room > 1)); else bringIn(markRows); }
    this.revealMark = false;
    // The comment being written (PIE-770) comes into view when it opens and as it's typed in: the inline box (its
    // cursor's row, when the box is taller than the view), else its passage. Otherwise the note holds still.
    const comp = laid.composer, writingIn = this.session?.composer ?? null;
    if (this.revealComposer && comp) {
      const box = comp.inline;
      if (box) {
        const a = top + box.at, b = a + box.box.lines.length;
        bringIn(b - a <= room || !writingIn ? [a, b] : [a + (box.box.frame?.row ?? 0) + writingIn.cursorRow, a + (box.box.frame?.row ?? 0) + writingIn.cursorRow + 1]);
      } else if (comp.passage) bringIn([top + comp.passage[0], top + comp.passage[1]]);
    }
    this.revealComposer = false;
    const sm = this.sourcesMode, inline = laid.sourcesInline;
    if (sm?.place === "inline" && inline && sm.reveal) {
      bringIn([top + inline.at, top + inline.at + inline.rows]); sm.reveal = false;
    }
    if (this.position.view || this.scroll > this.maxScroll) this.scroll = Math.max(0, Math.min(this.scroll, this.maxScroll));
    room = roomAt(this.scroll);
    // What scrolling into the header image moved in is brought in once more, at the room it has now.
    if (full && current && this.lastReveal) bringIn([current.row, current.row + 1]);
    if (this.position.view || this.scroll > this.maxScroll) this.scroll = Math.max(0, Math.min(this.scroll, this.maxScroll));
    room = roomAt(this.scroll);
    const heroRows = pinned ? full : Math.max(0, full - this.scroll);
    h -= heroRows;
    this.drawn = { w, h, top: head.length, scroll: this.scroll, room, doc, lines: noteLines, head, body, heroRows, roomAt, bx: this.bx, my: this.my, titleRows: title ? [title.row, title.row + title.rows] : own ? [0, 1] : [0, 0] };
    // The inline box's text and controls, where the scroll put them (a click or a drag there is the draft's).
    if (comp?.inline && writingIn) placeBox(writingIn, comp.inline.box, top + comp.inline.at - this.scroll, this.bx);
    if (sm?.place === "inline" && inline) {
      const r = attachedRect("inline", inline.cols, inline.rows, { from: top + inline.at - this.scroll + heroRows, col: this.bx });
      sm.rect = { x: r.col, y: r.row, w: r.cols, h: r.rows };
    }
    this.composerRows = comp?.passage ? [top + comp.passage[0] - this.scroll, top + Math.max(comp.passage[1], comp.after ?? 0) - this.scroll] : null;
    this.restoreCommentSelection();
    this.selectionControl(w);
    // The body's images, past its inset (the look's margin), cut to the rows shown.
    const bx = this.bx;
    const placements = imagePlacements(doc.images, bx, ...cellOf(host)).flatMap(p => inWindow(p, this.scroll, room, head.length) ?? []);
    for (const card of laid.margin.cards) {
      const images = card.images.map(im => ({ ...im, line: card.at + im.line }));
      placements.push(...imagePlacements(images, w - laid.margin.cols + 2, ...cellOf(host)).flatMap(p => inWindow(p, this.scroll, room, head.length) ?? []));
    }
    // An inline comment's preview pictures (PIE-846), where its box is in the rows shown.
    if (comp?.inline && writingIn) placements.push(...previewPictures(writingIn, head.length, head.length + room));
    // Where the links landed on screen: below the header, one column in (the body's margin), scrolled.
    // Each is the element it is, so a click also puts `[ ]` there.
    const keyOf = new Map(this.elems.filter(e => e.link).map(e => [`${e.row}:${e.from}`, e.key]));
    if (summary) for (const l of summaryLinks) this.hits.push({ row: summaryRow, from: l.from, to: Math.min(w, l.to), link: l.link, value: l.key, elem: keyOf.get(`${summaryRow}:${l.from}`) });
    // The crumbs: a click shows the note in the outline (reader.reveal, PIE-794), where the host has one.
    // Zoomed (PIE-780), that row is the zoom's: a click on it is esc's, element.zoom on=false.
    if (crumbsRow !== undefined && this.zoom && !this.printed) this.hits.push({ row: crumbsRow, from: 0, to: w, zoom: -1 });
    else if (crumbsRow !== undefined && host?.revealInOutline && isOutlineNote(m)) this.hits.push({ row: crumbsRow, from: 0, to: Math.max(1, Math.min(w, width(this.crumbs))), crumbs: true });
    if (commentChip) this.hits.push({ ...commentChip, start: "note" });
    if (sourcesChip) this.hits.push({ ...sourcesChip, sources: true });
    if (marginChip) this.hits.push({ ...marginChip, margin: true });
    for (const mark of wholeMarks ?? []) this.hits.push({ ...mark, elem: `comment:${mark.thread}` });
    const firstOf = new Map<number, string>();
    for (const r of doc.links) if (!firstOf.has(r.n)) firstOf.set(r.n, keyOf.get(`${top + r.line}:${r.from + bx}`) ?? "");
    for (const r of doc.links) {
      const row = r.line - this.scroll;
      const link = drawn[r.n];
      if (link && row >= 0 && row < room && r.from + bx < w) this.hits.push({ row: top + row, from: r.from + bx, to: Math.min(w, r.to + bx), link, elem: firstOf.get(r.n) || undefined });
    }
    // An image's caption opens it (its controls, tagged above, come first); a click on the image makes it the `[ ]` position.
    for (const e of this.elems) {
      if (!e.link?.media) continue;
      const row = e.row - top - this.scroll;
      if (row >= 0 && row < room) this.hits.push({ row: e.row - this.scroll, from: e.from, to: Math.min(w, e.to), link: e.link, elem: e.key });
      const x = doc.media.find(x => top + x.row === e.row), im = x?.image !== undefined ? doc.images[x.image] : undefined;
      if (im) for (let r = im.line; r < im.line + im.rows; r++) {
        const at = r - this.scroll;
        if (at >= 0 && at < room) this.hits.push({ row: top + at, from: bx + im.col, to: Math.min(w, bx + im.col + im.cols), image: e.key });
      }
    }
    for (const k of this.printed ? [] : marks) {
      const row = gutterRow(k);
      if (whole.has(k.thread)) continue;
      if (row >= top && row < top + room && (host?.externalGutter === undefined || (k.col ?? 0) + 4 <= host.externalGutter)) this.hits.push({ row, from: this.gutterStart + 1 + (k.col ?? 0), to: this.gutterStart + 1 + (k.col ?? 0) + 3, thread: k.thread, elem: `comment:${k.thread}` });
    }
    for (const c of controls) {
      const row = c.row - this.scroll;
      if (row >= 0 && row < room && c.from + bx < w) this.hits.push({ row: top + row, from: c.from + bx, to: Math.min(w, c.to + bx), thread: c.thread, elem: controlKey(c.thread, c.control, c.value) });
    }
    for (const [i, r] of (picks?.rows ?? []).entries()) {
      const row = r - this.scroll;
      if (row >= 0 && row < room) this.hits.push({ row: top + row, from: bx, to: w, pick: i });
    }
    // The reading ruler: the current element's block, and a focus mark's, in one calm tint. An expanded
    // thread's passage is highlighted while it's open (the ruler, where both are, wins).
    const reading = this.readingRows();
    const readingBand: [number, number] | null = reading && readingRuler() && !this.printed ? [top + reading[0], top + reading[1]] : null;
    // The element the cursor is on, when it is one row of something (a figure's row, a step): its rows are item-focused.
    const itemRows: [number, number] | null = current?.item && !this.printed ? current.item : null;
    const rulers = [markRows].filter((r): r is [number, number] => !!r);
    const ruled = (row: number) => rulers.some(([a, b]) => row >= a && row < b);
    const quoted = marks.filter(k => this.expanded.has(k.thread)).map(k => [top + k.rows[0], top + k.rows[1]] as const);
    // The passage a comment is being written on is lit as an open thread's is (PIE-770).
    if (comp?.passage) quoted.push([top + comp.passage[0], top + comp.passage[1]]);
    const inQuote = (row: number) => quoted.some(([a, b]) => row >= a && row < b);
    // The look's backgrounds (PIE-673, PIE-675): every other list item's zebra stripe, a box's surface, each across its
    // cells, under the ruler and a thread's tint (which take the whole row).
    const tints = doc.tints ?? [];
    // Highlights and annotated passages (ADR 0004 contract 6): each one's words on its tone's dark surface, under the
    // selections. The margin's side column, when there is one, is beside the body and never part of its rows.
    const spans = this.spansOf(laid, m, src);
    const mcols = laid.margin.cols, bodyW = w - mcols;
    const marked = (l: string, row: number) => {
      const ss = spans.get(row);
      if (!ss) return l;
      for (const t of ss) l = paintRange(l, Math.max(bx, t.from), Math.min(bodyW, t.to), t.bg);
      return l;
    };
    const lines = [...head, ...body.slice(this.scroll, this.scroll + room)].slice(0, Math.max(1, h)).map((l, i) => {
      const row = i < top ? i : i + this.scroll;
      const W = i < top ? w : bodyW;
      // Item focus (PIE-969): the row the cursor is on inside a figure or list, over the container's ruler tint.
      if (itemRows && row >= itemRows[0] && row < itemRows[1]) {
        const band = paintRange(pad(l, W), 0, W, host?.focused === false ? ITEM_IDLE_BG : ITEM_BG);
        const bar = bx > 0 && row >= top ? putCell(band, bx - 1, theme().focus.item.glyph, fgRgb(theme().focus.item.bar)) : null;
        const item = this.paintSelection(marked(bar ?? band, row), row);
        return host?.focused === false ? item : selectFullText(item);
      }
      const tint = ruled(row) ? RULER_BG : readingBand && row >= readingBand[0] && row < readingBand[1] ? (host?.focused === false ? RULER_IDLE_BG : RULER_BG) : inQuote(row) ? THREAD_BG : null;
      if (tint) return this.paintSelection(marked(paintRange(pad(l, W), 0, W, tint), row), row);
      const under = row >= top ? tints.filter(t => row - top >= t.rows[0] && row - top < t.rows[1]) : [];
      if (!under.length) return this.paintSelection(marked(l, row), row);
      let painted = pad(l, W);
      for (const t of under) painted = t.cols ? paintRange(painted, Math.max(0, t.cols[0] + bx), Math.min(W, t.cols[1] + bx), t.bg) : paintRange(painted, 0, W, t.bg);
      return this.paintSelection(marked(painted, row), row);
    });
    if (reading && readingRuler() && !this.printed && !this.selection && room > 0 && (reading[1] <= this.scroll || reading[0] >= this.scroll + room)) {
      const above = reading[1] <= this.scroll;
      // Selection controls own the separator while selecting; the marker must never hide an active control.
      const row = top - 1 - (headerRule ? 1 : 0);
      lines[row] = dim(pad(`reading line ${above ? "↑" : "↓"} ${this.readingSourceLine() + 1}`, w));
    }
    if (mcols) this.drawMargin(lines, laid, top, room, bodyW, mcols, itemRows);
    // A picture is placed under the text, and a terminal may draw it under every cell with a background of its own
    // (Tern does; Kitty draws it over them): its cells keep the terminal's own background, whatever tinted the rows
    // (an extension's region, the ruler, a box's surface), as the desk's surface yields there (PIE-839).
    onGround(lines, placements);
    // The copy control (PIE-638) on a code block, a quote and a callout: a dim ⧉ at the block's top right edge, bright while its
    // block holds the `[ ]` position. A click is block.copy, as y is. Not drawn over a code cell it would hide.
    const blockNow = current ? this.blockOf(current) : null;
    doc.blocks.forEach((b, n) => {
      if (b.kind === "span") {
        for (const cell of b.cells!) {
          const row = cell.row - this.scroll;
          if (row >= 0 && row < room && cell.from + bx < w) this.hits.push({ row: top + row, from: cell.from + bx, to: Math.min(w, cell.to + bx), block: n });
        }
        return;
      }
      if (b.col + bx >= w) return;
      // On its first row with a free cell there (a long first line of a quote or code fills its row).
      for (let r = b.row; r < b.row + Math.min(b.rows, COPY_ROWS); r++) {
        const row = r - this.scroll, at = top + row;
        if (row < 0 || row >= room || at >= lines.length) continue;
        const put = putCell(lines[at]!, b.col + bx, COPY_GLYPH, fg(n === blockNow ? C.lcyan : C.dark));
        if (put === null) continue;
        lines[at] = put;
        this.hits.push({ row: at, from: b.col + bx, to: b.col + bx + 1, block: n });
        break;
      }
    });
    if (laid.listInline) {
      const i = laid.listInline;
      const r = attachedRect("inline", i.cols, i.rows, { from: top + i.at - this.scroll + heroRows, col: this.bx });
      const children = this.listPreviewView(r.cols, r.rows, host, r.row, r.col)!;
      children.lines.forEach((line, n) => { const y = r.row + n; if (y >= top && y < top + room) lines[y] = " ".repeat(r.col) + line; });
    }
    // The header's backdrop (PIE-598): the hero image, muted, under the title, summary, byline and crumbs once it
    // goes under them.
    const headerRows = Math.min(lines.length, top);
    const shade = this.heroBackdrop(m, doc, noteLines, w, headerRows, host, this.scroll);
    const headerBand = this.headerSurface(lines, headerRows, w, shade);
    placements.unshift(...shade.placements);
    const gutter: { row: number; text: string }[] = [];
    const gutterRows = new Map<number, string>();
    if (!this.printed) for (const hd of doc.heads) {
      const first = top + hd.row - this.scroll, rows = hd.rows ?? 1;
      if (first + rows <= top || first >= top + room) continue;
      const n = this.foldsIn(m).points.findIndex(p => p.key === hd.key);
      if (n < 0) continue;
      const folded = this.effectiveFolded(this.foldsIn(m).points[n]!);
      if (first >= top) gutterRows.set(first, dim(folded ? "▸" : "▾"));
      // A wrapped heading is one heading (PIE-1349): a click on any of its rows folds it.
      for (let r = Math.max(top, first); r < Math.min(first + rows, top + room); r++) this.hits.push({ row: r, from: this.gutterStart, to: this.gutterStart + 1, fold: n + 1 });
      // The disclosure drawn at the heading's words (doc.ts's headingGlyph) is a click target as much as the gutter's (PIE-1403).
      // It is the first thing drawn at the body's start (indented or not); a ▸ in the heading's words is never one.
      if (first >= top) {
        let col = 0;
        for (const c of visible(lines[first] ?? "")) {
          if (col >= this.bx && c !== " ") { if (c === "▾" || c === "▸") this.hits.push({ row: first, from: col, to: col + 1, fold: n + 1 }); break; }
          col += width(c);
        }
      }
      // What a fold hides is said after its last row.
      const row = first + rows - 1;
      if (row < top || row >= top + room) continue;
      if (folded || this.foldsIn(m).points[n]!.kind === "list") {
        const list = this.foldsIn(m).points[n]!.kind === "list";
        const col = Math.max(0, Math.min(bodyW - 3, width(visible(lines[row] ?? "").trimEnd()) + 1));
        lines[row] = putCell(pad(lines[row] ?? "", bodyW), col, list ? "p" : "…", fg(C.dark)) ?? lines[row]!;
        this.hits.push({ row, from: col, to: col + 1, ...(list ? { listPreview: n + 1 } : { fold: n + 1 }) });
      }
    }
    // The zoom control (PIE-780) on a figure, a table or a heading: a dim ⤢ at its right edge, unless the reader is zoomed
    // into that part; drawn after a folded heading's … so that one stays after its words. A click is element.zoom on its line, as W is; which lines the part covers is the service's to say.
    // Only on the part the `[ ]` position (else the reading line) is in, as the copy control's is bright on its block: the
    // last part starting at or above that row, read as drawn. W and act reach any part; this is the mouse's way to the one here.
    const here = current ? current.row - top : this.readingRows()?.[0] ?? this.scroll;
    const shown = (doc.parts ?? []).filter(p => p.row <= here).at(-1);
    if (!this.printed && isOutlineNote(m)) for (const p of shown ? [shown] : []) {
      const row = p.row - this.scroll, at = top + row, line = noteLines[p.line];
      if (row < 0 || row >= room || at >= lines.length || line === undefined || p.col + bx >= w) continue;
      if (this.zoom && this.zoom.start === line) continue;
      // A folded heading's row is its fold's (its …): W still zooms into it.
      if (p.kind === "heading" && this.foldsIn(m).points.some(f => f.line === p.line && this.effectiveFolded(f))) continue;
      const put = putCell(lines[at]!, p.col + bx, ZOOM_GLYPH, fg(C.dark), p.kind === "figure" ? "·" : "");
      if (put === null) continue;
      lines[at] = put;
      this.hits.push({ row: at, from: p.col + bx, to: p.col + bx + 1, zoom: line });
    }
    // A generated region's one dim mark (src/output-region.ts), on its first row, with a click target.
    for (const r of this.printed || host?.externalGutter === 0 ? [] : doc.regions ?? []) {
      const row = top + r.row - this.scroll;
      if (row < top || row >= top + room || !this.regionInfo.has(r.key)) continue;
      // Zero chrome until the `[ ]` position is in the region (PIE-956 S6b): the mark is still a target, drawn only while it is open.
      if (this.openRegionKey() === r.key) gutterRows.set(row, pad(gutterRows.get(row) ?? "", 0) + fg(C.dark) + REGION_MARK + RESET);
      this.hits.push({ row, from: this.gutterStart, to: this.gutterStart + 1, region: r.key });
    }
    for (const k of this.printed ? [] : marks) {
      const row = gutterRow(k);
      if (whole.has(k.thread) || row < top || row >= top + room) continue;
      const glyph = this.threadShown(k.thread) ? "[–]" : "[+]";
      const old = gutterRows.get(row) ?? "";
      gutterRows.set(row, pad(old, 1 + (k.col ?? 0)) + fg(k.open ? C.yellow : C.dark) + glyph + RESET);
    }
    // An open card can sit below its passage; its gutter control stays beside its header too.
    for (const c of controls.filter(c => c.control === "toggle")) {
      const row = top + c.row - this.scroll, mark = marks.find(k => k.thread === c.thread);
      if (row < top || row >= top + room || !mark || (host?.externalGutter !== undefined && (mark.col ?? 0) + 3 > host.externalGutter)) continue;
      const col = 1 + (mark.col ?? 0);
      gutterRows.set(row, pad(gutterRows.get(row) ?? "", col) + fg(mark.open ? C.yellow : C.dark) + "[–]" + RESET);
      this.hits.push({ row, from: this.gutterStart + col, to: this.gutterStart + col + 3,
        thread: c.thread, elem: controlKey(c.thread, "toggle") });
    }
    for (const [row, text] of gutterRows) {
      if (host?.externalGutter !== undefined) gutter.push({ row, text });
      else lines[row] = pad(text, this.gutterWidth()) + tailFrom(lines[row] ?? "", this.gutterWidth());
    }
    if (foot) {
      while (lines.length < h) lines.push("");
      lines.push(foot.line);
      for (const x of foot.hits) this.hits.push({ row: h, from: x.from, to: x.to, history: x.dir });
    }
    return room > 0 ? { lines, placements, gutter, headerBand, scroll: { top: this.scroll, room, total: body.length } } : { lines, placements, headerBand };
  }

  private readonly fieldsDrawing: FieldsDrawing = new Map();

  /**
   * The note laid out at this width: its rows, links, elements and comment marks, everything but where it's
   * scrolled to. A frame in which only scrolling happened (onlyScrolled: the wheel and nothing else since the
   * last paint) reuses the last layout when the note and the pane's size are the same, so scrolling a long
   * note costs a slice, not a layout. Every other frame lays it out again.
   */
  private layOut(m: Msg, w: number, h: number, head: string[], summaryRow: number, summaryLinks: { from: number; to: number; link: Link; key: string }[], host: SurfaceHost | undefined, src: Source | null): Laid {
    const top = head.length, t = host?.ctx.t;
    // What the rules draw on the note (PIE-600), unless the person asked for it raw (R).
    const decorations = isOutlineNote(m) && !this.raw ? decorationsOf(m, src) : [];
    // The margin's side column (ADR 0004 contract 6): when the reader is wide and the note has cards to show.
    // The margin's default (PIE-791): current threads only; seen and resolved are on the thread list's earlier shelf.
    const cardThreads = this.cardThreads(m), mcols = this.marginCols(m, w);

    // The outline's callout types too: a type declared (or its answer arriving) draws the note again.
    const writing = this.composing(host);
    // Generated regions (src/output-region.ts): each draws flush, behind one gutter mark; the one the `[ ]` position is in shows what is behind it.
    const openKey = this.openRegionKey(), regionInfo = new Map<string, { label: string; target: LinkTarget }>();
    const book: RegionBook = { isOpen: k => k === openKey, add: r => regionInfo.set(r.key, { label: r.label, target: r.target }) };
    // A host's own rows after the note (EchoNet's tear line, origin and SEEN-BY): drawn after the body, never elements.
    const footRows = host?.footer?.(m, Math.max(1, w - this.bx - this.bxRight)) ?? [];
    const key = `${footRows.join("\n")}|${writing ? `${writing.cs.place}:${writing.d.text.length}:${writing.d.row}:${writing.d.col}|` : ""}${w}x${h}|${top}|${summaryRow}|${m.revision ?? ""}|${m.text.length}|${host?.ctx.graphics ? 1 : 0}|${t?.cellW}x${t?.cellH}|${calloutsStamp(calloutsOf(src))}|${headingStylesStamp(headingStylesOf(src))}|${this.hero?.line ?? ""}|${this.raw ? "raw" : decorations.length}|${this.lastLook?.stamp ?? ""}|${this.bx},${this.bxRight}|${mcols}:${this.marginMode}|${openKey ?? ""}`;
    if (this.sourcesMode?.place !== "inline" && !this.laid?.sourcesInline && onlyScrolled() && this.laid?.m === m && this.laid.key === key) return this.laid;
    this.fieldsDrawing.clear();
    // The header image is drawn above the title (render), so its line here is only its caption.
    const bw = Math.max(1, w - this.bx - this.bxRight - mcols);
    const look = this.lastLook;
    // A list's own look (PIE-675): its lead-in or heading line's fields, with this connection's tuning over them, by the note's line.
    const noteLine = this.foldsIn(m).lines;
    const lists = (n: number, f: Readonly<Record<string, string>>) => (noteLine[n] === undefined ? { ...f } : listFieldsTuned(this.src, m.id, noteLine[n]!, f));
    let listIndex = 0;
    const inlineList = (rows: string[], width: number) => {
      const key = listIndex++;
      let list = this.inlineLists.get(key);
      if (!list) this.inlineLists.set(key, list = new InlineList());
      return list.draw(key, rows, width, drawn, this.cur);
    };
    const env = { ...(!this.printed ? { inlineList } : {}), ...this.docEnv(bw, host, Math.max(4, Math.round((h - head.length) * 0.8))), hero: !!this.hero, ...(this.hero ? { heroLine: noteLine.indexOf(this.hero.line) } : {}), regions: book, fields: this.fieldsDrawing, ...(look ? { look: { values: look.values, layers: look.layers, width: look.width, lists } } : {}) };
    // Every link drawn (the body's, an embed's title, results, text and step boxes) is tagged with its place in `drawn`.
    const drawn: Link[] = [];
    // Resource projections (PIE-445): each drawn after the last body line at or above its anchor (a ticket
    // page's, on the subject or its preamble, above the first), its age painted now.
    // A Resource or a file shown as a note isn't a block: nothing the outline keeps for blocks is asked for it.
    const outline = isOutlineNote(m), now = Date.now();
    // Resource tokens (`[file::…]`, `[jira::KEY]`) as the service names them: links that show the Resource.
    const tokens = resourceTokensOf(m, src);
    // An extension's output (PIE-512) is drawn as this reader draws a note's body: its Markdown, inert (no
    // links to follow, no properties), flush with the note's text.
    const extDraw = {
      note: m.id,
      markdown: (text: string, width: number) => renderDoc(presentLinks(printableBlock(text), false, null), {
        ...env, width, graphics: false, noImages: undefined, folds: undefined, after: undefined, embed: undefined, task: undefined, link: undefined, literal: undefined, keepTags: false, regions: undefined, outputs: undefined,
      }).lines,
      // A view's Blockdown (a section a component lays out) is drawn as the body is: its links are links here.
      blockdown: (text: string, width: number) => renderDoc(presentLinks(printableBlock(text), false, src, text, drawn), {
        ...env, width, nested: true, keepTags: true, graphics: false, noImages: undefined, folds: undefined, after: undefined, embed: undefined,
        task: undefined, link: undefined, literal: undefined, decorate: undefined, callout: undefined, regions: undefined, outputs: undefined,
      }).lines,
      // A view's picture (PIE-827), laid out as the body's image lines are.
      image: (node: ImagePrimitive, width: number) => pictureRows(node, width, env, drawn),
      // A view's link names a block, or (PIE-754) a Resource the extension wants opened.
      row: (block: string, text: string) => tagged(drawn, isResourceRef(block) ? { resourceRef: block, label: block, role: "row" } : { block, role: "row" }, text),
      // A view's `list` (PIE-747): the one ListView, its state this reader's, its rows the reader's elements.
      ...(this.printed ? {} : { list: (node: ListPrimitive, width: number, run: (act: string) => LinkTarget) => this.viewList(node, width, run, this.listEnv, drawn, text => extDraw.markdown(text, Math.max(8, width))) }),
      hostKeys: host?.ownKeys ?? "",
    };
    const { doc: rendered, points, lines: noteLines } = this.body(m, env, src, drawn, tokens, (source, noteLines) => {
      const regions = regionsByLine(outline ? projectionsOf(m, src) : [], noteLines), bodyText = source.split("\n");
      // A view note's results under its body, drawn as an embedded view (the service's answer).
      const last = bodyText.length - 1, results = outline ? (width: number) => viewResults(m, width, src, drawn, env.inlineList) : null;
      const view = !!results && (prop(m, "type") ?? "").toLowerCase() === "virtual-branch";
      // The rules' decorations (PIE-600): above or below what they matched, in its place, or around it.
      const plan = planDecorations(decorations, noteLines, { row: extDraw.row, press: (act, text) => tagged(drawn, { role: "control", label: text, press: { act, block: m.id, line: 0 } }, text), markdown: extDraw.markdown, blockdown: extDraw.blockdown, image: extDraw.image, headings: headingStylesOf(src) }, bodyText);
      for (const [line, ps] of regions) {
        const replace = ps.filter(({ p }) => p.output?.component?.placement === "replace");
        if (!replace.length) continue;
        plan.place.set(line, { end: line + 1, draw: width => ({ rows: replace.flatMap(({ p }) => extensionRegion(p, width, now, (to, text) => tagged(drawn, to, text), extDraw, book).rows) }) });
        regions.set(line, ps.filter(p => !replace.includes(p)));
      }
      return regions.size || view || plan.after.size || plan.place.size ? {
        ...(plan.place.size ? {
          decorate: (line: number, width: number) => {
            const p = plan.place.get(line), r = p?.draw(width);
            return p && r ? { end: p.end, ...r } : null;
          },
        } : {}),
        after: (line: number, width: number) => {
          const decor = (plan.after.get(line) ?? []).flatMap(f => f(width));
          const ps = regions.get(line);
          const tail = view && line === last ? ["", ...(results!(width) ?? [])] : [];
          if (!ps) return joinRows([decor, tail.length > 1 ? tail : []]);
          const indent = line >= 0 ? /^[ \t]*/.exec(bodyText[line] ?? "")![0].length : 0;
          const tag = (to: LinkTarget, text: string) => tagged(drawn, to, text);
          // A ticket kept as a block (PIE-445), and an extension's record (PIE-507), is drawn from that block:
          // on a page, all of it under its line; on the ticket block itself, its header on top and its
          // comments after the body. An extension's other lines (an output, a component, an @name request)
          // draw their result with their actions (PIE-512).
          // Generated lines (an output, a component, a request) are drawn flush, behind one gutter mark (src/output-region.ts).
          return joinRows([decor, ...ps.map(({ p, part }) => p.record
            ? ticketRegion(p, ticketBlocksOf(p, src), part, width, indent, now, tag)
            : p.kind ? extensionRegion(p, width, now, tag, extDraw, book)
            : projectionRegion([p], width, indent, now, tag)), tail.length > 1 ? tail : []]);
        },
      } : {};
    });
    if (isAnnotationBlock(m)) {
      const context = commentSubject(m.id, src);
      const target = context?.value;
      const on = target ? tagged(drawn, target.kind === "block" ? { block: target.blockId } : { resourceRef: `resource:${target.resourceId}` },
        target.kind === "block" ? presentLinks(`((${target.blockId}))`, false, src) : "Resource") : context?.error ?? "reading comment subject…";
      const intro = renderDoc(`on ${on}`, env);
      const outlinks = renderDoc("::outlinks", { ...env, note: m.id, tag: (to, text) => tagged(drawn, to, text) });
      const withContext = withRows(rendered, [
        { at: 0, lines: [...intro.lines, ""], links: intro.links },
        { at: rendered.lines.length, lines: ["", ...outlinks.lines], links: outlinks.links.map(l => ({ ...l, line: l.line + 1 })) },
      ]).doc;
      Object.assign(rendered, withContext);
    }
    placePictures(rendered, drawn);
    // Expanded comment threads (PIE-420) are drawn under their passage, as rows of the body; an open status
    // choice (PIE-472) under its step.
    // The comment being written inline (PIE-770) is a box of rows under its passage, after an expanded thread's.
    const inlineRect = attachedRect("inline", bw, h - top, { min: { cols: 24, rows: 8 } });
    const inlineBox = writing?.cs.place === "inline" ? composerBox(writing.d, writing.f, Math.min(inlineRect.cols, 96), inlineRect.rows) : null;
    const threads = this.threadPanels(m, rendered, noteLines, bw, mcols === 0, inlineBox?.lines, host, drawn);
    const sm = this.sourcesMode;
    const sourceRect = attachedRect("inline", bw, Math.min(20, h - top - 2));
    const inline = sm?.place === "inline" ? this.renderSources(sourceRect.cols, sourceRect.rows, sourceRect.row, sourceRect.col) : null;
    const sourcesInline = inline ? { at: threads.doc.lines.length, cols: sourceRect.cols, rows: inline.lines.length } : undefined;
    const withSource = inline ? withRows(threads.doc, [{ at: sourcesInline!.at, lines: inline.lines }]).doc : threads.doc;
    const selectedList = this.listPreview.place === "inline" && !host?.hasWiredPreview?.() ? this.previewPoint() : null;
    const lastItem = selectedList && points.findLast(p => p.list?.key === selectedList.list!.key);
    const listInline = lastItem ? { at: withSource.source.findLastIndex(line => line >= lastItem.line && line < lastItem.end) + 1, cols: bw, rows: 12 } : undefined;
    const withList = listInline ? withRows(withSource, [{ at: listInline.at, lines: Array.from({ length: listInline.rows }, () => "") }]).doc : withSource;
    const { doc, picks } = this.pickerRows(withList, drawn, bw);
    if (listInline && picks && picks.at <= listInline.at) listInline.at += picks.lines;
    if (sourcesInline && picks && picks.at <= sourcesInline.at) sourcesInline.at += picks.lines;
    const shift = (r: number) => r + (picks && r >= picks.at ? picks.lines : 0);
    const composer = writing ? {
      passage: threads.passage && [shift(threads.passage[0]), shift(threads.passage[1])] as [number, number],
      inline: inlineBox && threads.composerAt !== null ? { at: shift(threads.composerAt), box: inlineBox } : null,
      after: threads.composerAt === null ? null : shift(threads.composerAt),
    } : null;
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
    const inset = " ".repeat(this.bx);
    // A card under its passage juts into the body's inset (PIE-1255), on its own background, so it reads as beside
    // the words, not in them; its cells (and its controls') stay where the body's are.
    const jut = Math.max(0, Math.min(2, this.bx - (host?.externalGutter !== undefined ? 0 : this.gutterWidth())));
    const cardAt = new Map<number, string>();
    if (jut) for (const c of threads.cards) for (let r = c.at; r < c.at + c.rows; r++) cardAt.set(shift(r) + (listInline && listInline.at <= shift(r) ? listInline.rows : 0), c.bg);
    const body = doc.lines.map((l, r) => {
      const bg = cardAt.get(r), row = bg ? inset.slice(jut) + bg + " ".repeat(jut) + l : inset + l;
      return width(row) > w ? pad(row, w) : row;
    });
    const marks = this.commentMarks(m, doc, noteLines);
    if (this.printed) for (const row of new Set(marks.map(k => k.row))) if (body[row])
      body[row] = fg(marks.some(k => k.row === row && k.open) ? C.yellow : C.dark) + "▐" + RESET + body[row]!.slice(1);
    this.regionInfo = regionInfo;
    this.regionSpans = (doc.regions ?? []).map(r => ({ key: r.key, from: top + r.row, to: top + r.row + r.rows }));
    // Both placements use the same card and controls; width alone chooses beside or below the passage.
    const cards = mcols ? placeCards(cardThreads.flatMap(c => {
      const k = marks.find(x => x.thread === c.id);
      if (!k) return [];
      const card = this.threadCard(c, mcols - 2, host, drawn);
      return [{ thread: c.id, row: k.row, rows: card.lines, controls: card.controls, images: card.images, links: card.links }];
    })) : [];
    for (const card of cards) {
      const dx = w - mcols + 2 - this.bx;
      for (const b of codeSpans(card.rows, card.rows.map(() => -1))) doc.blocks.push({
        ...b, row: card.at + b.row, col: dx + b.col, to: dx + b.to!,
        cells: b.cells!.map(c => ({ row: card.at + c.row, from: dx + c.from, to: dx + c.to })),
      });
    }
    const elems = this.elementsOf(doc, drawn, marks, controls, summaryLinks, points, top, head, summaryRow, this.imageRefOf(m, noteLines));
    for (const card of cards) {
      const cardDoc: Doc = { lines: card.rows, links: card.links, images: [], media: [], heads: [], trims: new Map(), blocks: [], source: card.rows.map(() => -1) };
      const offset = w - mcols + 2 - this.bx;
      for (const e of this.elementsOf(cardDoc, drawn, [], [], [], [], top + card.at, []))
        elems.push({ ...e, key: `margin:${card.thread}:${e.key}`, from: e.from + offset, to: e.to + offset });
    }
    for (const card of cards) for (const c of card.controls) {
      if (elems.some(e => e.key === controlKey(c.thread, c.control, c.value))) continue;
      const row = top + card.at + c.row, from = w - mcols + 2 + c.from, to = w - mcols + 2 + c.to;
      elems.push({ key: controlKey(c.thread, c.control, c.value), kind: "control", row, from, to,
        ruler: [row, row + 1], label: c.label, thread: c.thread, control: c.control, value: c.value });
    }
    elems.sort((a, b) => a.row - b.row || a.from - b.from);
    const cardEnd = Math.max(0, ...cards.map(c => c.at + c.rows.length));
    while (body.length < cardEnd) body.push("");
    if (footRows.length) body.push(...footRows.map(l => pad(inset + l, w) + RESET));
    return (this.laid = { m, key, doc, drawn, picks, controls, body, marks, lines: noteLines, elems, margin: { cols: mcols, cards }, composer, sourcesInline, listInline });
  }

  /**
   * The open proposals beside the note (PIE-725), by the body line each is drawn after: its mark's line, else the
   * last, as its embed line was put before proposals moved out of the note's text. Each is drawn as an embed of it
   * (`preview`), so its `[apply] [dismiss]`, `A` and `X` are the embed's.
   */
  private besideRegions(m: Msg, noteLines: readonly number[], src: Source | null, preview: ((id: string, width: number) => string[]) | undefined): Map<number, ((width: number) => string[])[]> {
    const out = new Map<number, ((width: number) => string[])[]>();
    if (!preview || !isOutlineNote(m)) return out;
    for (const p of proposalsBeside(m, src)) {
      const at = Math.max(noteLines.findLastIndex(n => n <= p.afterLine), Math.min(0, noteLines.length - 1));
      const g = out.get(at) ?? [];
      g.push(width => preview(p.id, width));
      out.set(at, g);
    }
    return out;
  }

  /**
   * What the note's body is drawn with, at `width`: images laid out when the host draws Kitty graphics (and why not
   * when it doesn't).
   */
  /** Why a press of action line `act` would be refused now (the dispatcher of the host this surface last drew for), or null. */
  private refusedPress: (act: string) => string | null = () => null;

  private docEnv(width: number, host: SurfaceHost | undefined, maxImageRows: number): DocEnv {
    const d = (host?.ctx as { dispatch?: import("./dispatch").Dispatcher } | undefined)?.dispatch;
    if (d) this.refusedPress = act => { try { return d.refusedNow(actRequestOf(lineWords(act)), USER); } catch { return null; } };
    const t = host?.ctx.t, graphics = !!host?.ctx.graphics;
    const noImages = graphics ? undefined : t?.kitty ? "video: cells · alt+v draws images" : "no Kitty graphics in this terminal";
    return { width, cellW: t?.cellW ?? 9, cellH: t?.cellH ?? 18, graphics, noImages, maxImageRows, unfold: this.unfold, callouts: calloutsOf(this.src), headings: headingStylesOf(this.src), printed: this.printed };
  }

  /** The note's body for the reader and a host's digest (folds, links, embeds, steps, tagged into `drawn`); `more`: the reader's own. */
  private body(m: Msg, env: DocEnv, src: Source | null, drawn: Link[], tokens?: ReturnType<typeof resourceTokensOf>, more?: (text: string, lines: readonly number[]) => Partial<DocEnv>) {
    let { text, points, lines, literal, anchors } = this.foldsIn(m);
    const form = !this.raw ? this.formOf(m) : null;
    if (form) {
      const body = text.split("\n");
      for (const chip of [...form.chips].reverse()) {
        const line = lines.indexOf(chip.line);
        if (line >= 0) body[line] = body[line]!.slice(0, chip.column) + body[line]!.slice(chip.column + chip.raw.length);
      }
      text = body.join("\n");
    }
    // A component's `^name` (PIE-747) is the key its view state is kept under: read mode hides an anchor, so it is put back on
    // the component's first line for the renderer, which doesn't draw it.
    if (anchors.some(Boolean)) text = text.split("\n").map((l, i) => (anchors[i] && /^ {0,3}::[a-z]/.test(l) ? `${l} ^${anchors[i]}` : l)).join("\n");
    this.keepFolds(points);
    // The live figures this layout draws, each told here; a tab or the density drawn as a control.
    const figures: FigureInfo[] = [];
    this.figuresDrawn = figures;
    // The inline ::links components this layout draws (PIE-693), each told here.
    const blocks: ListHandle<any>[] = [];
    this.linkBlocksDrawn = blocks;
    const { preview, spanPreview, ...hooks } = this.bodyHooks(m, lines, env, src, drawn);
    const additions = withBeside(more?.(text, lines) ?? {}, this.besideRegions(m, lines, src, preview));
    const after = additions.after, lastFormLine = text.split("\n").length - 1;
    if (form) additions.after = (line, width) => joinRows([
      after?.(line, width) ?? [],
      ...(line === lastFormLine ? [form.draw(width, this.modes.get("form")?.of === form, (field, value, act) => tagged(drawn, {
        role: "control", label: field, form: { field }, press: { act: `${act} tile=${m.id}`, block: m.id, line: 0 },
      }, value))] : []),
    ]);
    // What the inline lists (a ::links component, an extension's list view) are lent: their lists, the person in one, how a row and the control are tagged.
    this.listEnv = this.printed ? undefined : {
      list: (key, signature) => this.listFor(key, false, signature),
      entered: key => this.listIn === key,
      row: (key, row, to, x) => tagged(drawn, { ...to, listRow: { key, row } }, x),
      control: (key, x) => tagged(drawn, { role: "control", label: key, listRow: { key } }, x),
      ...(preview ? { preview } : {}),
      seen: info => blocks.push(info),
    };
    const doc = renderDoc(presentLinks(text, expandsEmbeds(!!hooks.embed, m), src, m.text, drawn, tokens, isOutlineNote(m) ? { block: m.id } : undefined), {
      ...env, literal, ...hooks, ...(isOutlineNote(m) ? { outputs: new Map(findOutputRegions(text).map(r => [r.startLine, r])) } : {}),
      linkBlocks: this.listEnv,
      callout: this.calloutHook(m, lines, points, drawn),
      image: this.imageHook(m, lines, drawn),
      // An artifact's card (PIE-793): its file read through the service, the card drawn again once it's read.
      ...(src && isOutlineNote(m) ? { artifact: spec => artifactFacts(spec, { scope: src.board, read: name => src.board.request<ArtifactInfo>("artifacts.show", { name }), changed: () => src.redraw() }) } : {}),
      folds: { points, folded: this.effectiveFolds(m), selected: this.foldSel, preview: new Set(points.filter(p => this.previews(p)).map(p => p.key)) },
      link: (block, x, figure, query, at) => tagged(drawn, { ...(query ? { query, label: query } : { block, ...(at !== undefined ? { revision: at } : {}) }), role: "row", ...(figure ? { figure: { figure } } : {}) }, x),
      figures: this.printed ? { all: true, seen: f => figures.push(f) } : {
        ui: key => this.figureUI.get(key),
        tag: (c, x) => tagged(drawn, { role: "figure", figure: c, label: c.tab ?? `≡ density ${this.figureUI.get(c.figure)?.density ?? ""}`.trim() }, x),
        seen: f => figures.push(f),
      },
      tag: (to, x) => tagged(drawn, to, x), note: m.id,
      ...additions,
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
  /**
   * Text written about the note (a comment's body, a reply, the composer's preview, an edit's ctrl+p preview: PIE-852)
   * drawn as the reader draws the note (PIE-770): references by their titles, `[[pages]]`, Markdown, and `!((embeds))` transcluded, through renderDoc and
   * presentLinks. Its links aren't elements: what's followable is the note's own.
   */
  private previewDraft?: { block: string; text: string; ready: boolean; timer: ReturnType<typeof setTimeout>; board?: SocketBoard; unlisten?: () => void };

  private endPreviewDraft() {
    clearTimeout(this.previewDraft?.timer);
    this.previewDraft?.unlisten?.();
    // Watches belong to their connection: retiring the draft ends its service work too.
    this.previewDraft?.board?.close();
    this.previewDraft = undefined;
  }

  static draftPreviewDoc(text: string, width: number, src: Source | null, links: LinkTarget[]): Doc & { pending: boolean } {
    const env: DocEnv = { width: Math.max(10, width), cellW: 9, cellH: 18, graphics: false, maxImageRows: 8, unfold: true, callouts: calloutsOf(src), headings: headingStylesOf(src) };
    const hooks = new NoteSurface().bodyHooks(null, [], env, src, links);
    const doc = renderDoc(presentLinks(text, expandsEmbeds(!!hooks.embed), src, text, links), { ...env, ...hooks });
    return { ...doc, pending: !!src && embedsLoading(src.board) };
  }

  snippet(text: string, width: number, host?: SurfaceHost): string[] { return this.snippetDoc(text, width, host).lines; }
  /** `snippet` with where its links are drawn (`links`: their targets, by `.links`' `n`), for a draft's preview to follow. */
  snippetDoc(text: string, width: number, host?: SurfaceHost, drawn: Link[] = [], pictures = false, draftOf?: string): { lines: string[]; links: LinkRange[]; pending: boolean; placements: Placement[]; images: DocImage[]; source: number[] } {
    const m = this.msg, src = this.src;
    // `pictures`: its img:: lines drawn as the reader draws them (PIE-846), where the terminal can; else each says what it is.
    const graphics = pictures && !!host?.ctx.graphics;
    const env: DocEnv = { ...this.docEnv(Math.max(10, width), host, 8), graphics, noImages: undefined, unfold: true };
    const drawEmbed = m ? this.bodyHooks(m, [], env, src, drawn).embed : undefined;
    // One of its own embeds still being read: an edit's preview draws it again when the answer's redraw comes (src/surface/editor.ts).
    let pending = false;
    const embed: DocEnv["embed"] = drawEmbed && m ? (id, fragment, n, w) => {
      const out = drawEmbed(id, fragment, n, w);
      pending ||= embedState(id, fragment, src, m.id).kind === "loading";
      return out;
    } : undefined;
    let site: LiveSite | undefined;
    if (draftOf) {
      if (this.previewDraft?.block !== draftOf || this.previewDraft.text !== text) {
        this.endPreviewDraft();
        const board = src ? new SocketBoard(src.board.path, undefined, src.board.outline) : undefined;
        const draft = { block: draftOf, text, ready: false, board, unlisten: board?.watched.listen(() => src?.redraw()), timer: setTimeout(() => { draft.ready = true; src?.redraw(); }, 150) };
        this.previewDraft = draft;
      }
      pending ||= !this.previewDraft.ready;
      site = { board: this.previewDraft.board, draft: { text }, pending: !this.previewDraft.ready, changed: loading => { pending ||= loading; } };
    }
    // `draftOf`: the text is that note's unsaved one (an edit's preview): its `{{ }}` are read from the text as typed (PIE-533 S2).
    const doc = renderDoc(presentLinks(printable(text.replace(/\t/g, " "), "", { lines: true }), expandsEmbeds(!!embed, m ?? undefined), src, text, drawn, undefined, draftOf && !site?.pending ? { block: draftOf, draft: true } : undefined), { ...env, ...(draftOf ? { note: draftOf, site } : {}), ...(embed ? { embed } : {}) });
    // Its `{{ }}` still being read: drawn again on the redraw the answer brings.
    if (draftOf && !site?.pending && siteAnswerWaiting(draftOf, text, src, true)) pending = true;
    // `images` for a host that lays them out in its own rows (a thread's panel), `placements` for one that places them as drawn (a preview).
    return { lines: doc.lines, source: doc.source, links: doc.links, pending, placements: graphics ? imagePlacements(doc.images, 0, ...cellOf(host)) : [], images: graphics ? doc.images : [] };
  }

  /** Text written about the note on one line, as a margin card says it: references by their titles (PIE-770). */
  said(text: string): string {
    // A picture's line says what it is (PIE-846), as the reader's caption does, never its path and attributes.
    const named = text.split("\n").map(l => { const m = parseMediaLine(l); return m ? `▣ ${m.alt ?? fileName(m.path)}` : l; }).join("\n");
    return stripMarks(stripTags(presentLinks(named, false, this.src, named)));
  }

  private bodyHooks(m: Msg | null, noteLines: readonly number[], env: DocEnv, src: Source | null, drawn: Link[]): Pick<DocEnv, "embed" | "task" | "present" | "liveStep" | "use"> & { preview?: (id: string, width: number) => string[]; spanPreview: (startLine: number, endLine: number, width: number) => string[] } {
    // How many embedded bodies and template bodies are being drawn inside one another: an embed starts a fresh `::use`
    // depth and a template body a fresh embed one, so a note that embeds a template that embeds it back is stopped here.
    let nest = 0;
    const tooDeep = (): string[] => [`${fg(C.dark)}drawn inside itself too many times${RESET}`];
    const nested = <T>(draw: () => T, stop: () => T): T => {
      if (nest >= 8) return stop();
      nest++;
      try { return draw(); } finally { nest--; }
    };
    const inner: EmbedBody = (target, part, width, hooks) => nested(() => {
      let source = src;
      if (target.address && this.context) {
        const pool = outlineBoards(this.context);
        const ctx = pool.peek(target.address);
        if (!ctx) { void pool.on(target.address).then(() => src?.redraw(), (error: Error) => this.context?.flash(error.message, undefined, errorDetails(error))); return ["reading the other outline..."]; }
        source = { board: ctx.board, redraw: () => src?.redraw() };
      }
      const firstLink = drawn.length;
      let text: string, lines: number[], lit: Set<number>;
      if (part) {
        text = part.text;
        lines = text.split("\n").map((_, i) => part.startLine + i);
        const inside = target.text.includes("<!--") ? literalLines(target.text).inside : new Set<number>();
        lit = new Set(lines.flatMap((l, i) => (inside.has(l) ? [i] : [])));
      } else ({ text, lines, literal: lit } = readableSource(target, source));
      const projections = isOutlineNote(target) ? projectionsOf(target, source) : [];
      const projected = regionsByLine(projections, lines, { slice: !!part });
      const inert = (text: string, width: number) => renderDoc(text, { ...env, width, graphics: false, after: undefined, embed: undefined, keepTags: false }).lines;
      const rendered = renderDoc(presentLinks(text, expandsEmbeds(!!hooks.embed, target), source, target.text, drawn, undefined, isOutlineNote(target) ? { block: target.id } : undefined), {
        ...childEnv(env, { off: 0, end: lines.length, width }), heroLine: -1, graphics: false, noImages: undefined, literal: lit, keepTags: true, folds: undefined, regions: undefined, outputs: undefined,
        // A fragment's figure isn't its note's figure block: the note's child bullets are the whole note's rows.
        nested: !!part,
        decorate: (line, width) => {
          const ps = projected.get(line)?.filter(({ p }) => p.output?.component?.placement === "replace");
          return ps?.length ? { end: line + 1, rows: ps.flatMap(({ p }) => extensionRegion(p, width, Date.now(), (to, text) => tagged(drawn, to, text), { note: target.id, markdown: inert }).rows) } : null;
        },
        after: (line, width) => {
          const ps = projected.get(line)?.filter(({ p }) => p.output?.component?.placement !== "replace");
          return ps ? { rows: ps.flatMap(({ p }) => extensionRegion(p, width, Date.now(), (to, text) => tagged(drawn, to, text), { note: target.id, markdown: inert, row: (block, text) => tagged(drawn, { block, role: "row" }, text) }).rows) } : [];
        },
        link: (block, t, figure, query, at) => tagged(drawn, { ...(query ? { query, label: query } : { block, ...(at !== undefined ? { revision: at } : {}) }), role: "row", ...(figure ? { figure: { figure } } : {}) }, t),
        // The template is the definition (`self`); the chain says the host is `this`, so a figure over `{{this.project}}` reads the host.
        tag: (to, t) => tagged(drawn, to, t), note: target.id,
        embed: hooks.embed, task: (i, box) => hooks.task(lines[i] ?? -1, box),
        // A `::use` in an embedded note hosts that note: a fresh Site, as an embed starts one.
        use: isOutlineNote(target) ? useHook(target.id, lines, undefined, 0) : undefined,
        present: presenter(target.text), liveStep,
      }).lines;
      if (target.address) for (const link of drawn.slice(firstLink)) {
        if (!link.outline && (link.block || link.page)) Object.assign(link, target.address);
      }
      return rendered;
    }, tooDeep);
    // A template's body (PIE-533 S4), drawn where its `::use` is written: the reader's renderer over the template's text, in the
    // call's Site (`this` the host, `{{props.x}}` the call's), so values, figures, `::fields` and `::if` read the host.
    const templateBody = (depth: number) => (target: Msg, site: LiveSite, width: number): string[] => nested(() => {
      const { text, lines, literal } = readableSource(target, src);
      const call: SiteCall = { ...(site.chain?.length ? { chain: site.chain } : {}), ...(site.props ? { props: site.props } : {}) };
      return renderDoc(presentLinks(text, true, src, target.text, drawn, undefined, { block: target.id, call }), {
        ...childEnv(env, { off: 0, end: lines.length, width }), heroLine: -1, graphics: false, noImages: undefined, literal, keepTags: true, folds: undefined, after: undefined, regions: undefined, outputs: undefined,
        link: (block, t, figure, query, at) => tagged(drawn, { ...(query ? { query, label: query } : { block, ...(at !== undefined ? { revision: at } : {}) }), role: "row", ...(figure ? { figure: { figure } } : {}) }, t),
        tag: (to, t) => tagged(drawn, to, t), note: target.id,
        embed: embedHook, task: () => null, present: presenter(target.text), liveStep, site,
        use: useHook(target.id, lines, { ...(site.chain?.length ? { chain: site.chain } : {}), ...(site.props ? { props: site.props } : {}) }, depth + 1),
      }).lines;
    }, tooDeep);
    // The `::use` on body line `i`, drawn: `block` is the note whose text holds the line, `lines` its body lines' note lines.
    const useHook = (block: string, lines: readonly number[], site: UseSite | undefined, depth: number, book?: RegionBook): DocEnv["use"] => (call, i, width) => {
      const line = lines[i] ?? -1;
      if (line < 0) return [];
      return useRegion({ call, line, host: block, ...(site ? { site } : {}), top: m?.id ?? "", width, src, sink: drawn, depth, body: templateBody(depth), ...(book ? { book } : {}) });
    };
    // A `::button` on body line `i` (PIE-957): the button part, a press of its action line on this note, in its press's state or
    // disabled with the action's refusal now (PIE-1287).
    const buttonHook = (block: string, lines: readonly number[]): DocEnv["button"] => (call, i) => {
      const line = lines[i] ?? -1, label = printable(call.label);
      if (call.act === null || line < 0) return [fg(C.yellow) + `[${label}] ${call.problem ?? ""}` + RESET];
      const pressed = pressState(block, line, call.label), start = call.sequence ? sequenceStart(call) : call.act, refused = pressed.state || call.empty.length || !start ? null : this.refusedPress(start);
      return buttonRows(label, { ...call.look, ...pressed, ...(refused ? { state: "disabled", why: refused } : {}) },
        t => tagged(drawn, { role: "control", label, press: { act: call.act!, steps: call.steps, ...(call.alt ? { alt: call.alt } : {}), block, line, label: call.label } }, t));
    };
    const embedHook = (id: string, fragment: string | undefined, n: number, width: number) => embedRegion(id, fragment, n, width, src, inner, drawn, m?.id ?? "", env.inlineList);
    // A component's words as a line of the note (PIE-864): its links elements, unless its row is itself a link.
    const presenter = (noteText: string) => (t: string, linked: boolean) => presentLinks(t, false, src, noteText, linked ? undefined : drawn);
    // A live ::graph-check row's box: a step of its own note, whose mark writes the property its `done:` names.
    const liveStep: DocEnv["liveStep"] = (row, box) => LINK_ON + tagged(drawn, { role: "task", block: row.block, task: { block: row.block, revision: 0, step: liveRowStep(row), live: row.mark } }, box) + LINK_OFF;
    // A Resource or a file shown as a note has no steps, and its `!((…))` isn't the outline's to transclude.
    const outline = expandsEmbeds(!!src, m ?? undefined);
    const steps = m && isOutlineNote(m) ? stepsOf(m, src) : null;
    const stepAt = new Map((steps?.items ?? []).map(st => [st.span.startLine, st]));
    const task: NonNullable<DocEnv["task"]> = (i, box) => {
      if (!m) return null;
      const line = noteLines[i] ?? -1, st = stepAt.get(line);
      if (st && steps && steps.revision !== m.revision && !stepStillOn(st, m.text, line)) return null;
      const shown = boxStatus(box) === st?.status ? STEP_BOXES[st.status] : box;
      return st && steps ? LINK_ON + tagged(drawn, { role: "task", block: m.id, task: { block: m.id, revision: steps.revision, step: st } }, shown) + LINK_OFF : null;
    };
    return {
      spanPreview: (startLine, endLine, width) => m ? embedRegion(m.id, undefined, 0, width, src, inner, drawn, m.id, env.inlineList, { note: m, startLine, endLine, task: (line, box) => task(noteLines.indexOf(line), box) }) : [],
      present: presenter(m?.text ?? ""), ...(outline ? { liveStep } : {}),
      ...(outline ? { embed: embedHook } : {}),
      ...(m && outline ? { use: useHook(m.id, noteLines, undefined, 0, env.regions), button: buttonHook(m.id, noteLines) } : {}),
      // An inline ::links component's preview of its selected row (PIE-693): that note drawn as an embed of it is.
      ...(outline ? { preview: (id: string, width: number) => embedRegion(id, undefined, 0, width, src, inner, drawn, m?.id ?? "") } : {}),
      task,
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
  digest(m: Msg, w: number, host: SurfaceHost, maxImageRows = 8): { lines: string[]; links: { row: number; from: number; to: number; link: Link }[]; folds: { row: number; cols: number; n: number }[]; placements: Placement[]; current: number | null; key: string | null; trims: Doc["trims"]; blocks: { row: number; rows: number; col: number; to?: number; kind: DocBlock["kind"]; n: number }[] } {
    const src = this.use(host);
    this.drawn = null;
    this.digesting = true;
    // A digest's elements are counted as the reader's always were (one column in); its host draws its own margin.
    this.bx = 1; this.bxRight = 0;
    const drawn: Link[] = [];
    // A digest draws no header image above the note: it's drawn where it's written.
    this.hero = null;
    const { doc: rendered, points, lines: noteLines } = this.body(m, this.docEnv(Math.max(1, w), host, maxImageRows), src, drawn);
    const { doc, picks } = this.pickerRows(rendered, drawn, Math.max(1, w));
    this.digested = { m, w, maxImageRows, doc, lines: noteLines };
    this.elems = this.elementsOf(doc, drawn, [], [], [], points, 0, [], 0, this.imageRefOf(m, noteLines));
    this.keepCurrent(host);
    const current = this.elems.find(e => e.key === this.cur);
    const lines = doc.lines.map((l, r) => (current && r >= current.ruler[0] && r < current.ruler[1] ? paintRange(pad(l, w), 0, w, RULER_BG) : l));
    const links = doc.links.flatMap(r => (drawn[r.n] ? [{ row: r.line, from: r.from, to: r.to, link: drawn[r.n]! }] : []));
    for (const [i, row] of (picks?.rows ?? []).entries()) links.push({ row, from: 0, to: w, link: { role: this.picker?.kind === "callout" ? "callout" : "task", choice: i } });
    // Every row of a wrapped heading is its disclosure (PIE-1349).
    const folds = doc.heads.flatMap(h => { const n = points.findIndex(p => p.key === h.key); return n < 0 ? [] : Array.from({ length: h.rows ?? 1 }, (_, k) => ({ row: h.row + k, cols: h.cols, n: n + 1 })); });
    const placements = imagePlacements(doc.images, 0, ...cellOf(host));
    onGround(lines, placements);
    return { lines, links, folds, placements, current: current ? current.row : null, key: current?.key ?? null, trims: doc.trims, blocks: doc.blocks.flatMap<ReturnType<NoteSurface["digest"]>["blocks"][number]>((b, n) => b.kind === "span" ? b.cells!.map(c => ({ row: c.row, rows: 1, col: c.from, to: c.to, kind: b.kind, n })) : [{ row: b.row, rows: b.rows, col: b.col, kind: b.kind, n }]) };
  }

  /** A fold whose heading or item is gone (or reworded) is dropped, so it never hides a different section. */
  private keepFolds(points: readonly FoldPoint[]) {
    const keys = new Set(points.map(p => p.key));
    // A callout that starts folded (`[!type]-`) is folded when the reader first meets it (unless z shows callouts).
    for (const p of points) if (!this.foldSeen.has(p.key)) { this.foldSeen.add(p.key); if (p.start === "folded" && !this.unfold) this.folded.add(p.key); }
    for (const k of this.folded) if (!keys.has(k)) this.folded.delete(k);
    if (this.foldSel && !keys.has(this.foldSel)) this.foldSel = null;
  }

  /**
   * Whether the reader, drawn in `rows` rows, shows the note's title in its own header: then its tile's frame bar
   * needn't say it again (a short tile, a host's own header or an edit in its place, or a note that leaves its title out
   * with `[header::…]`, PIE-1319, leaves the title to the frame).
   */
  titleShown(rows: number, tile?: TileHeader): boolean { return !!this.msg && rows >= 2 && !this.modes.covers && !headerShown(this.msg, tile).title; }

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
  private summaryView(m: Msg, src: Source | null, rest: number = C.dark) {
    const segs = summarySegments((m.properties ?? []).filter(p => p.key.toLowerCase() !== "subtitle"), this.summary(m).keys);
    const prefix = workIdPrefix(src) ?? null;
    const links: { from: number; to: number; link: Link; key: string }[] = [];
    let col = 0, line = "";
    segs.forEach((s, i) => {
      if (i) { line += " · "; col += 3; }
      line += s.label + " "; col += [...s.label].length + 1;
      splitPropertyValue(s.value).forEach((v, j) => {
        if (j) { line += ", "; col += 2; }
        const t = valueTarget(s.key, v, prefix), n = [...v].length;
        if (t) { links.push({ from: col, to: col + n, link: t, key: s.key }); line += fg(C.lcyan) + v + fg(rest); }
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
    this.panel.card = null;
  }

  // ── the settings card (PIE-786): a configurable note's fields, from its component schema ──────────────

  /** The schema `m` is configured by (a rule note's, a view's, a callout type's…), or null when it's no such note. */
  settingsSchemaOf(m: Msg): ComponentSchema[] | null {
    const found = settingsSchemas(componentsOf(this.src), this.rows(m).filter(r => r.scope === "block"));
    return found.length ? found : null;
  }

  /** The card's fields for `m`, as the note is now. */
  settingFields(m: Msg, schema: readonly ComponentSchema[]): SettingField[] {
    return settingFields(schema, this.rows(m).filter(r => r.scope === "block"));
  }

  /** Open the settings card on the note in front: the property panel's other face. */
  openSettings(m: Msg): SettingsCard {
    const schema = this.settingsSchemaOf(m);
    if (!schema) throw new ActionRefused("this note isn't configured by a component: a rule note ([rule-name::]), a view ([query::]), a callout type, a heading style or an extension's own has a card · i lists its properties");
    if (!this.panel) this.panel = new PropertyPanel();
    this.panel.full = false;
    const card = new SettingsCard(schema);
    if (this.panel.card?.id !== card.id) this.panel.card = card;
    return this.panel.card;
  }

  /** What a field's picker reads: the outline's properties and values, the extensions' actions and ids. */
  settingSources(host: SurfaceHost): SettingSources {
    const listed = () => (extensionList()?.extensions ?? []).filter(e => e.state === "active" || e.state === "failed");
    return {
      catalog: (key, prefix) => host.ctx.board.propertyCatalog(key, prefix, 30),
      actions: () => listed().flatMap(e => e.actions.filter(a => (a.on ?? "block") === "block" && !a.builtIn).map(a => ({
        value: `${e.id}/${a.id}`, label: `${e.id}/${a.id} · ${a.label}`,
        ...(a.args?.length ? { detail: `asks ${a.args.map(x => x.name).join(", ")}` } : a.effects ? { detail: a.effects } : {}),
      }))),
      extensions: () => listed().map(e => e.id),
      // EchoNet's nodelist (one note per outline, `type=nodelist`), read with its own parser.
      nodes: async () => {
        const { notes } = await host.ctx.board.queryNotes(NODELIST_QUERY, 10, "show").catch(() => ({ notes: [] as Msg[] }));
        const whole = await Promise.all(notes.map(n => host.ctx.board.get(n.id).catch(() => null)));
        return [...new Set(whole.flatMap(n => (n ? nodesOf(n.text).map(e => e.node) : [])))];
      },
    };
  }

  /**
   * Write one field: the note's block token for `key` replaced, appended when it has none, or (null) every one removed;
   * one `properties.patch` at the revision its tokens were read at, attributed to `actor`.
   */
  async writeSetting(m: Msg, key: string, value: string | null, host: SurfaceHost, actor: Actor): Promise<Msg> {
    const no = agentRefusal(actor, { board: host.ctx.board, blockId: m.id });
    if (no) throw new ActionRefused(no);
    const t = await host.ctx.board.propertyTokens(m.id, key);
    // Written at the revision the card (or the question) was read at: a change made meanwhile is never written over.
    if (m.revision === undefined || t.revision !== m.revision) throw new EditConflict(m.id, "changed since the settings were read");
    const own = t.tokens.filter(x => x.scope === "block");
    const operations = value === null ? own.map(x => ({ op: "remove" as const, ordinal: x.ordinal }))
      : own.length ? [{ op: "replace" as const, ordinal: own[0]!.ordinal, value }] : [{ op: "append" as const, key, value }];
    if (!operations.length) return m;
    const saved = await host.ctx.board.patchProperties(m.id, t.revision, operations, actor);
    if (this.msg?.id === m.id) { this.refresh({ ...saved, childIds: this.msg.childIds }); this.links = linksOf(this.msg!); }
    return saved;
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
    if (this.panel) this.panel.note = `copied ${r.key}: ${printable(r.value)}`;
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
    this.panel.field = { row: r, input: Object.assign(new LineField(r.value, false, { complete: { valueKey: r.key } }), { near: m.id }), revision: m.revision, saving: false, note: "", changedElsewhere: false };
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
      const said = `saved · revision ${saved.revision} · ${f.row.key}: ${printable(f.row.value)} → ${printable(value)}`;
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
    if (P.card) {
      const fields = this.settingFields(m, P.card.schemas);
      const intent = P.card.key(k, fields.length), f = fields[P.card.sel];
      // The card's commands are the settings.* actions; moving its selection is its own.
      if (intent === "close") void this.runKey("props.close", {}, host);
      else if (intent === "tokens") void this.runKey("props", {}, host);
      else if (f && intent === "pick") void this.runKey("settings.set", { key: f.prop.key }, host);
      else if (f && intent === "clear") void this.runKey("settings.clear", { key: f.prop.key }, host);
      host.redraw();
      return true;
    }
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

  /**
   * What each handler line last drew (an extension's output or a script's view), kept under its line while the note is
   * edited, read-only (PIE-981): `Draft.kept` for the raw edit and the rich one. The note as it was read says which line
   * drew what; a line that moved since (a line typed above it) still gets its drawing, found by its text.
   */
  private keptDrawings(d: Draft, m: Msg): Draft["kept"] {
    if (!isOutlineNote(m)) return null;
    const drawn = projectionsOf(m, this.src).filter(p => (p.kind === "output" || p.kind === "component") && !p.record && p.output && (p.status === "ready" || p.status === "stale"));
    if (!drawn.length) return null;
    const was = m.text.split("\n"), at = new Map<number, ResourceProjection[]>();
    for (const p of drawn) {
      const line = p.anchor.line, text = was[line];
      let to = d.lines[line] === text ? line : -1;
      for (let k = 1; to < 0 && k <= d.lines.length; k++) to = d.lines[line - k] === text ? line - k : d.lines[line + k] === text ? line + k : -1;
      if (to >= 0) at.set(to, [...(at.get(to) ?? []), p]);
    }
    const now = Date.now(), memo = new Map<string, string[]>();
    const doc = (text: string, width: number) => this.snippetDoc(text, width).lines;
    return (line, width) => {
      const ps = at.get(line);
      if (!ps) return [];
      const key = `${line}|${width}`;
      let rows = memo.get(key);
      if (!rows) memo.set(key, (rows = ps.flatMap(p => extensionRegion(p, width, now, undefined, { note: m.id, markdown: doc, blockdown: doc, bare: true }).rows)));
      return rows;
    };
  }

  private renderDraft(d: Draft, m: Msg, w: number, h: number, away = false, host?: SurfaceHost, attached = true): SurfaceView {
    if (attached && d.preview && host && !elementEdit(d).on) return this.renderEditPreview(d, m, w, h, away, host);
    const kept = this.keptDrawings(d, m), help = host ? this.buttonEditing(d, host) : null;
    d.inks = help?.inks ?? null;
    d.kept = help ? (line, width) => [...(kept?.(line, width) ?? []), ...help.under(line, width)] : kept;
    const by = writtenBy(d, "save");
    if (elementEdit(d).on) return { lines: elementEdit(d).render(w, h, (t, width) => this.snippetDoc(t, width), by ?? undefined) };
    return { lines: renderEditor(d, {
      look: this.lastLook?.values, attachedPreview: !!host,
      preview: (t, pw, links) => this.snippetDoc(t, pw, undefined, links, false, isOutlineNote(m) ? m.id : undefined), pick: true, follow: true, ...(away ? { away } : {}),
      // A new note says where it lands, a click to move it (PIE-883).
      ...(this.newNotes.has(m.id) ? { lands: `→ ${this.crumbs}` } : {}),
      title: `editing · ${subject({ ...m, text: d.text })}`,
      status: [
        fg(C.brown) + pad(`rev ${d.base} · ${draftState(d)}`, w) + RESET,
        // Who typed it takes the hint's row, not a row of its own: an agent's patch landing never moves the text down. What
        // the draft says (an ask: the undo at a save) wraps onto up to three rows rather than being cut (PIE-1428).
        ...d.note ? rowLines(d.note, w, 3).map(l => fg(C.cyan) + pad(l, w) + RESET)
          : by ? [fg(C.lmagenta) + pad(by, w) + RESET]
          : [fg(C.cyan) + pad("whole text: subject, body and [key::value] properties", w) + RESET],
      ],
    }, w, h) };
  }

  private editPreviewRows(w: number, h: number, row: number, col: number, host: SurfaceHost, aligned = false): SurfaceView {
    const d = this.draft!, m = this.msg!, p = this.editPreview;
    p.rect = { row, col, cols: w, rows: h };
    const lines = previewRows(d, (t, pw, links) => this.snippetDoc(t, pw, host, links, true, isOutlineNote(m) ? m.id : undefined), w, h, row, col, aligned);
    const chip = `[${p.place} ▸]`;
    lines[0] = pad(lines[0]!, Math.max(0, w - chip.length)) + fg(C.lcyan) + chip + RESET;
    return { lines, placements: d.frame?.preview?.placements };
  }

  private renderEditPreview(d: Draft, m: Msg, w: number, h: number, away: boolean, host: SurfaceHost): SurfaceView {
    const p = this.editPreview;
    p.frame = null;
    p.room = this.innerFrame ? { w: this.innerFrame.cols, h: this.innerFrame.rows, col: this.innerFrame.col, row: this.innerFrame.row } : { w, h };
    const read = (cols: number, rows: number): SurfaceView => this.renderDraft(d, m, cols, rows, away, host, false);
    if (p.place === "tile") return read(w, h);
    p.rect = null;
    if (p.place === "split" || p.place === "inline") {
      return this.renderBeside(w, h, host, (cols, rows, row, col) => this.editPreviewRows(cols, rows, row, col, host, col > 0), "edit-preview", read);
    }
    const v = read(w, h), rect = attachedRect(p.place, w, h, { frame: this.innerFrame, min: { cols: 30, rows: 6 }, moved: p.float });
    p.frame = rect;
    const side = this.editPreviewRows(rect.cols - 2, rect.rows - 2, rect.row + 1, rect.col + 1, host);
    return { ...v, frame: this.innerFrame, lines: drawAttachedFloat(v.lines, w, h, rect, "edit preview", false, this.lastLook?.values,
      (canvas, dx, dy) => side.lines.forEach((l, i) => canvas.text(rect.col + 1 + dx, rect.row + 1 + i + dy, l, rect.cols - 2)), p.place === "floating", this.innerFrame, v.frame) };
  }

  editPreviewTile(w: number, h: number, host: SurfaceHost): SurfaceView | null {
    if (!this.draft?.preview || this.editPreview.place !== "tile") return null;
    return this.withPlacementMenu(this.editPreviewRows(w, h, 0, 0, host), w, h, "edit-preview");
  }

  editPreviewKey(k: Key, host: SurfaceHost): boolean {
    if (this.placementMenu) return this.modes.key(k, host) ?? true;
    const binding = modeBinding(EDIT_PREVIEW_KEYS, k);
    if (binding) {
      void this.runKey(binding.action as keyof NoteActionArgs, binding.args as never, host);
    }
    return true;
  }

  async placeEditPreview(place: string | undefined, host: SurfaceHost, side?: AttachedSide) {
    if (!this.draft?.preview) throw new ActionRefused("ctrl+p shows the edit preview first");
    const want = attachedPlaceOf(place ?? (side ? "tile" : nextPlace(this.editPreview.place, !!host.editPreviewTile)));
    if (!want) throw new ActionRefused(`place is ${ATTACHED_PLACES.join(", ")}`);
    if (want === "tile" && !host.editPreviewTile) throw new ActionRefused("this reader has no tiles; use split");
    if (want === "inline") this.splits["edit-preview"] = { direction: "down", share: .5 };
    await this.placeAttachment("edit-preview", want, host, side);
    writeState("edit-preview-place.json", { place: want, split: this.splits["edit-preview"] });
    host.redraw(); return { place: want };
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
      if (!still || still()) host.ctx.flash(why, undefined, errorDetails(e));
      return why;
    }
    if (still && !still()) return;
    if (!fresh || fresh.revision === undefined) { host.ctx.flash("can't edit: the outline didn't say which revision this note is at"); return; }
    if (this.msg?.id !== m.id || this.editing) return;
    try { this.startDraft(fresh, host); }
    catch (e) { const why = e instanceof Error ? e.message : String(e); host.ctx.flash(why, undefined, errorDetails(e)); return why; }
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
      reread: m => { if (this.msg?.id === m.id) this.msg = this.rereadNote(m); },
      redraw,
    });
    this.anchorView();
    const row = fresh.text.slice(0, this.position.reading).split("\n").length - 1;
    this.position.cursor = { row, col: 0 };
    this.readingLine(row);
    const s: DraftSession = DraftSession.open(target, { text: fresh.text, base: fresh.revision ?? 0, props: propertyListOf(fresh), by: host.actor ?? USER, position: this.position }, {
      board: host.ctx.board, redraw,
      agentDid: (by, did) => this.noteAgent(by, did, s.draft),
      // The person's own `@name` line invites its answer beside their edit (as the draft rule reads it): an agent's
      // answer tile opens there even while they type, the keys staying in the edit (PIE-1294).
      answered: (ask, by) => {
        const as = s.openedBy.kind === "user" && by.kind === "agent" ? { ...by, invitation: INVITES.mint("your ask", ["shape"]) } : by;
        void this.act("ask.beside", { ask }, host, as).catch(e => host.ctx.flash(String(e), undefined, errorDetails(e)));
      },
      closed: how => this.draftClosed(s, how, host),
    });
    s.draft.onAskSelected = (ask, fold) => { void this.runKey("ask.beside", { ask, fold }, host); };
    this.msg = this.rereadNote(fresh);
    this.modes.push(this.draftMode(s));
    return s;
  }

  private replyRowAt(x: number, y: number): LinkRow | undefined {
    const mode = this.replyLinks;
    if (!mode) return;
    y += this.drawn?.heroRows ?? 0;
    const r = mode.rect;
    if (x < r.x || x >= r.x + r.w || y <= r.y || y >= r.y + r.h) return;
    return mode.rowsAt[mode.drawnItems[y - r.y - 1] ?? -1];
  }

  closeReplyLinks() { this.modes.drop("replies"); }
  closeRevision() { this.revisionAsk = null; this.modes.drop("revision"); }
  /** The compare takes the keys (on), or leaves them to a comment being written: it opens without them over one. */
  focusRevision(host: SurfaceHost, on: boolean) {
    const rv = this.revisionMode;
    if (!rv) throw new ActionRefused("open the revision compare first (revision.compare)");
    this.modes.focus(rv, on);
    if (on) host.enterMode?.();
    host.redraw();
    return { keys: on ? "revision" : "reader" };
  }
  /** The compare's last ask: only its answer is drawn, and none once the compare is closed. */
  private revisionAsk: object | null = null;

  /**
   * Open (or move) the revision compare (PIE-1433): revision `revision` of this note (left out: the one before the
   * note now) against the next one kept, or against the note now; scrolled to `passage` when given, else the first change.
   */
  async openRevision(host: SurfaceHost, revision: number | undefined, against: RevisionAgainst, passage?: string): Promise<RevisionView> {
    const m = this.requireNote();
    const ask = {};
    this.revisionAsk = ask;
    // A step that fails leaves the next one stepping from the revision drawn.
    const diff = await compareAt(host.ctx.board, m.id, revision, against).catch((e: unknown) => { if (this.revisionAsk === ask) delete this.revisionMode?.want; throw e; });
    const view: RevisionView = { diff, against, top: 0, opening: openingRow(diff.rows, passage), ...(passage ? { passage } : {}) };
    if (this.msg?.id !== m.id) throw new ActionRefused("the reader moved to another note while the revision was read; open it again");
    // Only the last ask lands (two ← in one chunk both ask, and the older's answer may come second), and none after Esc.
    if (this.revisionAsk !== ask) return view;
    const had = this.revisionMode;
    if (had && had.blockId === m.id) { had.view = view; delete had.want; host.redraw(); return view; }
    const run = (action: string, args: Record<string, unknown> = {}) => { void this.runKey(action as Parameters<NoteSurface["runKey"]>[0], args, host); };
    const mode: RevisionMode = {
      // It takes only its own keys (REVISION_KEYS): the desk's still work, and Esc closes it once its tile has the keys.
      name: "revision", of: view, word: "revision", noun: "the revision compare", holdsKeys: false, keys: REVISION_KEYS,
      blockId: m.id, view, controls: [], body: 2, rect: { x: 0, y: 0, w: 0, h: 0 },
      editing: () => false, covers: () => false,
      key: k => { const b = modeBinding(REVISION_KEYS, k); if (b) run(b.action, b.args); return !!b; },
      click: (x, y) => {
        y += this.drawn?.heroRows ?? 0;
        const r = mode.rect;
        // A click outside it while a comment is being written gives the comment its keys back; one in it, the compare.
        if (x < r.x || x >= r.x + r.w || y < r.y || y >= r.y + r.h) { if (this.session && this.modes.active(mode)) run("revision.focus", { on: false }); return undefined; }
        if (!this.modes.active(mode)) run("revision.focus", { on: true });
        if (y === r.y) { const c = mode.controls.find(hit => x - r.x >= hit.from && x - r.x < hit.to); if (c) run(c.action); }
        return true;
      },
      wheel: (dir, _host, at) => {
        const r = mode.rect, y = at ? at.y + (this.drawn?.heroRows ?? 0) : -1;
        if (!at || at.x < r.x || at.x >= r.x + r.w || y < r.y || y >= r.y + r.h) return false;
        run("revision.scroll", { by: dir * 3 }); return true;
      },
      rows: () => null, leave: async () => { this.closeRevision(); return { left: "nothing" }; },
      hint: () => modeHint(REVISION_KEYS, action => NOTE_ACTIONS.def(action)), state: () => (this.modes.active(mode) ? "revision" : null),
      describe: () => revisionFacts(mode.view),
      // The note was saved meanwhile (a new revision): a compare against the note now reads it again.
      changed: (revision, partial) => {
        const v = mode.view;
        if (partial || mode.want !== undefined || revision === v.diff.current || (v.against !== "now" && v.diff.to.revision !== v.diff.current)) return;
        void this.openRevision(host, v.diff.from.revision, v.against, v.passage).catch(() => {});
      },
    };
    this.modes.push(mode);
    if (this.session) this.modes.focus(mode, false);
    host.redraw();
    return view;
  }

  async openReplyLinks(host: SurfaceHost, actor: Actor, refresh = false) {
    if (actor.kind === "user" && this.editing) throw new ActionRefused("finish the draft before opening its thread");
    const previous = this.replyLinks;
    const m = this.requireNote();
    const [replies, links, backlinks, thread] = await Promise.all([readReplies(host.ctx.board, m.id, host.conference), host.ctx.board.authoredLinks(m.id), host.ctx.board.backlinks(m.id), readThread(host.ctx.board, m, host.conference)]);
    const out = { replies: replies.children.map(c => c.block.id), truncated: replies.truncated };
    // The opening token expires once the panel opens; refresh follows the same note and mode instead.
    if (actor.kind === "agent" || this.msg?.id !== m.id || (!refresh && host.still && !host.still())) return out;
    const data: LinkData = { links: { kind: "ready", value: links }, backlinks: { kind: "ready", value: backlinks }, children: { kind: "ready", value: replies.children } };
    if (refresh) {
      if (previous && this.replyLinks === previous) {
        // The selection stays on its post when the thread changes under it (a reply arrived above it).
        const keep = previous.rowsAt[previous.selected]?.key;
        previous.data = data; previous.thread = thread;
        if (previous.group === "thread") previous.rowsAt = threadRows(thread, previous.unfolded);
        const at = previous.group === "thread" && keep ? previous.rowsAt.findIndex(r => r.key === keep) : -1;
        if (at >= 0) previous.selected = at; previous.truncated = replies.truncated || thread.truncated; } host.redraw(); return out; }
    const row = (n?: number) => mode.rowsAt[n === undefined ? mode.selected : n - 1];
    // Folds expand in place; note rows use the reader tile's open or alt wire.
    const go = (n?: number, fresh = false) => run(row(n)?.kind === "fold" ? "note.thread.unfold" : "note.thread.open", { ...(n === undefined ? {} : { n }), ...(fresh && row(n)?.kind !== "fold" ? { fresh: true } : {}) });
    const run = (action: "note.thread.close" | "note.thread.pick" | "note.thread.open" | "note.thread.unfold" | "note.thread.groups" | "note.thread.full", args: Record<string, unknown> = {}) => { void this.runKey(action, args, host); };
    const mode: ReplyLinksMode = {
      get keys() {
        const picked = row(), keys = picked?.kind === "fold" ? REPLIES_FOLD_KEYS : REPLIES_KEYS;
        return picked?.kind === "child" ? keys : keys.filter(binding => binding.action !== "note.move" && binding.action !== "note.move.undo");
      },
      controls: [],
      name: "replies", of: m, word: "replies", holdsKeys: true, editing: () => false, covers: () => false,
      data, thread, unfolded: new Set(), presses: new RowPresses(), picked: false, top: 0, truncated: replies.truncated || thread.truncated,
      selected: Math.max(0, threadRows(thread).findIndex(r => r.kind === "child" && r.thread?.here)), group: "thread", rect: { x: 0, y: 0, w: 0, h: 0 }, rowsAt: [], drawnItems: [],
      key: k => {
        const binding = modeBinding(mode.keys!, k);
        if (!binding) return true;
        const picked = row();
        if (binding.action === "note.move" || binding.action === "note.move.undo") {
          if (picked?.kind === "child") void this.runKey(binding.action, { id: picked.child.block.id, ...(binding.action === "note.move" ? { revision: picked.child.block.revision } : {}), ...binding.args }, host);
        } else run(binding.action as Parameters<typeof run>[0], binding.args);
        return true;
      },
      click: (x, y, host) => {
        y += this.drawn?.heroRows ?? 0;
        const r = mode.rect;
        if (x < r.x || x >= r.x + r.w || y < r.y || y >= r.y + r.h) return undefined;
        if (y === r.y) {
          const control = mode.controls.find(hit => x - r.x >= hit.from && x - r.x < hit.to);
          if (control) run(control.action);
          return true;
        }
        const i = mode.drawnItems[y - r.y - 1] ?? -1;
        if (i < 0 || i >= mode.rowsAt.length) return true;
        // One rule for every list's rows (RowPresses): a click selects (the one that gave the reader the keys only does that),
        // a double click opens, and an alt-click uses the alt wire.
        const g = mode.presses.press(i, { focusing: !!host.focusing, selected: mode.picked && i === mode.selected, mods: host.freshClick ? MOUSE_ALT : 0 });
        if (g === "open" || g === "fresh") go(i + 1, g === "fresh"); else run("note.thread.pick", { n: i + 1 });
        return true;
      },
      wheel: (dir, _host, at) => { if (!at || at.x < mode.rect.x || at.y < mode.rect.y) return false; run("note.thread.pick", { by: dir }); return true; },
      rows: () => null, leave: async () => { this.modes.drop("replies"); return { left: "nothing" }; },
      hint: () => modeHint(mode.keys!, action => NOTE_ACTIONS.def(action)), state: () => "replies",
      describe: () => ({ replies: mode.data.children?.kind === "ready" ? mode.data.children.value.map(c => c.block.id) : [], truncated: mode.truncated, group: mode.group, rows: mode.rowsAt.map((r, i) => describeLinkRow(r, i + 1, i === mode.selected)) }),
    };
    this.modes.push(mode); host.redraw(); return out;
  }

  private replyFrame(host?: SurfaceHost): EditFrame {
    return { look: host?.look?.values ?? this.lastLook?.values, title: `reply · ${subject(this.replyParent!)}`, status: [], pick: true, follow: true,
      preview: (text, w, links) => this.snippetDoc(text, w, host, links),
    };
  }

  async quoteSelection(host: SurfaceHost, actor: Actor, quote?: string): Promise<string> {
    const m = this.requireNote(), passage = this.passageFor(actor, quote).note;
    const line = m.text.slice(0, passage.start).split("\n").length - 1;
    const { items } = await host.ctx.board.fragmentCandidates({ blockIds: [m.id], fragmentQuery: passage.quote, mode: "passage", limit: 100 });
    const anchor = items.find(c => c.revision === m.revision && c.lineIndex === line && c.fragmentId)?.fragmentId;
    // The excerpt is frozen even when its source changes or an anchor cannot yet be written.
    return `> [!quote]\n${passage.quote.split("\n").map(l => `> ${l}`).join("\n")}\n> — ((${m.id}${anchor ? `^${anchor}` : ""}))\n\n`;
  }

  startReply(host: SurfaceHost, quote?: string): DraftSession {
    if (this.editing) throw new ActionRefused(`finish the open draft first · ${this.holdingHint()}`);
    const parent = this.requireNote();
    const target = noteReplyTarget(parent, host.ctx.board);
    const s: DraftSession = DraftSession.open(target, { text: `re:: ${subject(parent)}\n\n`, by: host.actor ?? USER }, {
      board: host.ctx.board, redraw: () => host.redraw(),
      closed: how => { this.draftClosed(s, how, host); host.redraw(); },
    });
    if (s.draft.restored === null) s.draft.row = s.draft.lines.length - 1;
    const mode = this.draftMode(s);
    mode.reply = parent;
    this.modes.push(mode);
    if (quote) { s.draft.pasteText(quote, host.actor ?? USER); this.clearSelections(); }
    host.redraw();
    return s;
  }

  private draftKey(k: Key, host: SurfaceHost): boolean {
    const s = this.drafting!;
    if (s.draft.preview && modeBinding(EDIT_PREVIEW_READER_KEYS, k) && !completionOf(s.draft)) return this.editPreviewKey(k, host);
    if (this.replyParent && ch(k) === '"' && this.selection) { void this.runKey("note.quote", {}, host); return true; }
    if (this.replyParent && (k.kind === "pgup" || k.kind === "pgdn")) { this.scrollKey(k, host); return true; }
    if (elementEdit(s.draft).key(k, (action, args = {}) => { void this.runKey(action, args, host); })) { host.redraw(); return true; }
    // A note's own edit runs actions where the person types (PIE-1076): ctrl+k lists them, ⏎ on a / line runs it.
    if (s.draft === this.draft && !completionOf(s.draft)?.items.length) {
      if (k.kind === "char" && k.ctrl && k.ch === "k" && !k.shift) { void this.runKey("edit.actions", {}, host); return true; }
      // Only a line that names an action, with the cursor at its end: `/tmp is full` is prose, and ⏎ is its new line.
      const line = s.draft.lines[s.draft.row] ?? "", here = k.kind === "enter" && s.draft.col === line.length ? actionHereAt(line, line.length, s.draft.lines, s.draft.row) : null;
      if (here && host.ctx.dispatch?.has(here.query.split(/\s/)[0]!)) { void this.runKey("edit.run", {}, host); return true; }
    }
    // What ends or hands off the draft is an action (PIE-506); the rest is typing.
    s.key(k, {
      completer: this.completer(s.draft, host),
      run: cmd => {
        if (cmd === "save") void this.runKey("edit.save", {}, host, true);
        else if (cmd === "editor") void this.runKey("edit.external", {}, host);
        else if (cmd === "pick") void this.runKey("draft.pick", {}, host);
        else if (cmd === "follow") void this.runKey("edit.follow", {}, host);
        else if (cmd === "image") void this.runKey("draft.image", {}, host);
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
    const c = completerFor(d, host.ctx.board, () => host.redraw(), () => (d === this.draft ? { blockId: d.blockId, text: d.text } : undefined));
    if (c && host.screen) c.where = () => host.screen?.();
    return c;
  }

  /**
   * The surface is going away with its screen (the reader, the river, a desk that isn't kept). Its draft's
   * hold is let go, so an agent's patch goes to the saved note and never into a draft no one can see or save.
   * Unsaved text was already copied to disk (keepDrafts) by the screen that asked before closing.
   */
  dispose() {
    this.endPreviewDraft();
    this.drafting?.dispose();
    // A comment read an event asked for (onEvent) doesn't go out for a reader that's gone.
    if (this.commentTimer) clearTimeout(this.commentTimer);
    this.commentTimer = null;
  }

  /**
   * The edit's session ended: written, closed with nothing changed, or put aside as unsent. What an agent did
   * to it is said no longer as if it were still open: gone once saved or closed, in the past tense once put aside.
   */
  private draftClosed(s: DraftSession, how: Ended, host?: SurfaceHost) {
    if (this.drafting !== s) return;
    if (!this.replyParent) this.position.reading = s.draft.offsetOf(s.draft.row, 0);
    this.endPreviewDraft();
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
  /** Where the note shown is now, read again (after a move): its path, as the reader's crumbs say it. */
  async rereadPlace(host: SurfaceHost): Promise<string> {
    const m = this.msg;
    if (!m) return this.crumbs;
    const a = await host.ctx.board.ancestors(m.id);
    if (this.msg?.id === m.id) { this.crumbs = a.map(subject).join(" › ") || "top level"; host.redraw(); }
    return this.crumbs;
  }
  /** Whether the note shown is a new one being written (`note.new`). */
  isNew(): boolean { return !!this.msg && this.newNotes.has(this.msg.id); }
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
      host.ctx.flash(changedSinceRead(e) ? "the new note was written meanwhile, so it stays" : `the empty new note stays: ${e instanceof Error ? e.message : String(e)}`, undefined, errorDetails(e));
      return;
    }
    host.ctx.flash("nothing written · the empty new note went to the trash");
    if (this.msg?.id === id) await this.runKey("back", {}, host, true).catch(() => {});
    if (this.msg?.id === id) host.gone?.(id);
    host.redraw();
  }

  /**
   * A `::button` line as it is typed (PIE-1312): its parts in colour and what won't run underlined, read by `buttonLineLook`, the
   * reader the save's warning uses; under the line at the cursor, one row saying what it runs or why it won't. A tile= is asked
   * about once per value (`tile.info`, the resolver's words) and the draft drawn again when the answer comes.
   */
  private buttonEditing(d: Draft, host: SurfaceHost): { inks: NonNullable<Draft["inks"]>; under: (line: number, w: number) => string[] } | null {
    if (!d.text.includes("::button")) return null;
    const ask = this.buttonLookups(host, USER);
    // Asked once per value while this edit lasts: the next edit asks again (a tile closed since).
    let tiles = BUTTON_TILES.get(d);
    if (!tiles) BUTTON_TILES.set(d, (tiles = new Map()));
    // Read once per text: a button with a body is read with its body, so its key is the lines it spans.
    const looks = new Map<string, ReturnType<typeof buttonLineLook>>();
    const lookOf = (line: number) => {
      const text = d.lines[line] ?? "";
      if (!text.includes("::button")) return null;
      const key = `${text}\n${d.lines.slice(line + 1, line + 40).join("\n")}`;
      if (!looks.has(key)) looks.set(key, buttonLineLook(d.lines, line, ask));
      const look = looks.get(key)!;
      for (const t of look?.tiles ?? []) if (!tiles.has(t.sel)) {
        tiles.set(t.sel, undefined);
        void ask.tile(t.sel).then(why => { tiles!.set(t.sel, why); host.redraw(); });
      }
      return look;
    };
    const INK = { name: C.lcyan, eq: C.dark, value: C.yellow, action: C.lgreen, arg: C.cyan } as const;
    return {
      inks: line => {
        const look = lookOf(line);
        if (!look) return null;
        return [...look.parts.map(p => ({ from: p.from, to: p.to, fg: INK[p.is] })),
          ...look.marks.map(m => ({ from: m.from, to: m.to, fg: C.lred, under: true })),
          ...look.tiles.filter(t => tiles!.get(t.sel)).map(t => ({ from: t.from, to: t.to, fg: C.lred, under: true }))];
      },
      under: (line, w) => {
        if (line !== d.row) return [];
        const look = lookOf(line);
        if (!look) return [];
        const why = [...look.marks.map(m => m.message), ...look.tiles.map(t => tiles!.get(t.sel)).filter((x): x is string => !!x)];
        const say = why.length ? fg(C.lred) + `✗ ${why[0]}${why.length > 1 ? ` · and ${why.length - 1} more` : ""}`
          : look.runs ? fg(C.dark) + `▸ runs ${look.runs.replace(/\n/g, " · ")}` : fg(C.lred) + `✗ ${look.problem ?? "it runs nothing"}`;
        return [drawEllipsized(say, w) + RESET];
      },
    };
  }

  /** What the door answers about a button's action line: the arguments an action takes, and why a tile= names no tile now. */
  buttonLookups(host: SurfaceHost, actor: Actor): ButtonLookups {
    // The door's actions, listed once for these lookups (an edit reads a line on every frame).
    let listed: ActionInfo[] | undefined;
    const all = () => (listed ??= (host.ctx as { dispatch?: import("./dispatch").Dispatcher }).dispatch?.list().actions ?? []);
    return {
      args: action => { const info = all().find(a => a.name === action); return info ? Object.keys(info.args) : null; },
      actions: () => all().map(a => a.name),
      tile: async sel => { const r = await tileNamed(host, sel, actor); return "why" in r ? r.why : null; },
    };
  }


  /** The block adapter saved the edit: show the saved note, and say so (and how it was recorded). */
  private saved(m: Msg, by: Actor, asked: Actor, change: string, host: SurfaceHost) {
    this.msg = { ...this.rereadNote(m), childIds: this.msg?.id === m.id ? this.msg.childIds : m.childIds };
    this.links = linksOf(this.msg);
    // The service decides which [key::value] tokens are properties (a token followed by more text on
    // its line is plain text), so say plainly when a save changed them: a card can leave its lane.
    this.notice = change ? `properties changed: ${change}` : "";
    const whose = sameParty(by, asked) && !by.with?.length ? "" : ` · recorded as ${recorded(by).says}`;
    host.ctx.flash(`saved · revision ${m.revision}${change ? ` · properties changed: ${change}` : ""}${whose}`);
    // Saved first; then a reference that leads nowhere is said, with what it may have meant (PIE-761), never refused.
    void savedReferenceWarning(host.ctx.board, m.text, m.id).then(async said => {
      // A button's arguments and tile= against the door's own actions and tiles (PIE-1298), in the same sentence.
      const marks = describeButtonMarks(await buttonMarks(m.text, this.buttonLookups(host, by)));
      const w = marks ? (said ? `${said} · ${marks}` : `saved; ${marks}`) : said;
      if (!w || this.msg?.id !== m.id || this.msg.revision !== m.revision) return;
      this.notice = [this.notice, w].filter(Boolean).join(" · ");
      host.ctx.flash(w, 12000);
      host.redraw();
    });
  }

  /**
   * Save the edit (ctrl+s, `edit.save`): its session writes it through the block adapter, recorded as whoever
   * wrote the text (recordAs), which is not always `actor`, who pressed save. Returns that, or null when
   * nothing was written (unchanged, a property change shown first, or refused: the draft says why).
   */
  async save(host: SurfaceHost, actor: Actor = host.actor ?? USER): Promise<Actor | null> {
    const s = this.drafting;
    if (!s || s.busy) return null;
    if (!s.dirty && !this.replyParent) { s.close(); host.ctx.flash("nothing changed"); host.redraw(); return null; }
    const reply = !!this.replyParent;
    const r = await s.submit(actor);
    host.redraw();
    return r.ok ? (reply ? recordAs(s.draft, actor) : r.result as Actor) : null;
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
      cwd: await pickerCwd(host.ctx.board, { blockId: this.msg?.id, ...(this.draft === d ? { draft: { text: d.text }, line: d.row } : {}) }),
      held: () => this.draft === d || this.session?.composer === d,
    });
    if ("kept" in r) host.ctx.flash(`${r.why}: ${r.kept} · copied to ${r.at}`, 12000);
    else if ("nothing" in r) d.note = r.nothing;
    host.redraw();
    return r;
  }

  // ── comments ───────────────────────────────────────────────────────────────

  async loadComments(host: SurfaceHost, retry = false): Promise<void> {
    const id = this.msg?.id;
    if (!id) return;
    try {
      let stale = false;
      const c = onTheirWords(alignComments(await host.ctx.board.comments(id, this.msg?.resource ? { revision: this.msg.revision, stale: () => { stale = true; } } : undefined), this.msg), this.msg?.text);
      // A Resource whose file changed since it was drawn: read again (the quotes were placed in the new text), once.
      if (stale && this.msg?.id === id && !retry) {
        const now = await host.ctx.board.get(id);
        if (now && this.msg?.id === id) { this.refresh(rereadResource(now, this.msg)); return this.loadComments(host, true); }
      }
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
    if (this.replyLinks) void this.openReplyLinks(host, USER, true).catch(e => host.ctx.flash(String(e), undefined, errorDetails(e)));
    if (!this.msg) return;
    if (this.commentTimer) clearTimeout(this.commentTimer);
    this.commentTimer = setTimeout(() => void this.loadComments(host), 700);
  }

  private commentEnv(host: SurfaceHost, actor: Actor = host.actor ?? USER): CommentEnv {
    return {
      board: host.ctx.board,
      fetch: id => host.ctx.board.get(id).then(n => n && this.msg ? rereadResource(n, this.msg) : n),
      setMsg: m => { if (this.msg?.id === m.id) { this.msg = { ...this.rereadNote(m), childIds: m.childIds.length ? m.childIds : this.msg.childIds }; this.links = linksOf(this.msg); } },
      reloadComments: async () => { await this.loadComments(host); return this.comments ?? []; },
      external: () => void this.runKey("edit.external", {}, host),
      pick: () => void this.runKey("draft.pick", {}, host),
      follow: () => void this.runKey("edit.follow", {}, host),
      image: () => void this.runKey("draft.image", {}, host),
      complete: d => this.completer(d, host),
      flash: m => host.ctx.flash(m),
      redraw: () => host.redraw(),
      // Written from the reader, it lands where the composer was: its thread shown under the passage (PIE-770).
      posted: id => { this.expanded.add(id); },
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
    const editOn = mine && mode === "threads" ? this.editOn : null;
    this.replyOn = null; this.editOn = null;
    if (!m || this.editing) return;
    // Text selected in the reader is where the passage picker starts: the same text, as a quote.
    const picked = mine && mode === "select" ? this.writeNext?.at ?? (this.selection ? this.sourceOf(this.selection) : null) : null;
    const read = mode === "select" || m.partial ? await host.ctx.board.get(m.id) : m;
    const fresh = read ? rereadResource(read, m) : read;
    if (still && !still()) return;
    if (!fresh || fresh.revision === undefined) { const why = "can't comment: the outline didn't say which revision this note is at"; host.ctx.flash(why); return why; }
    if (this.msg?.id !== m.id || this.editing) return;
    this.msg = this.rereadNote(fresh);
    if (this.commentsFor !== m.id) await this.loadComments(host);
    if ((still && !still()) || this.msg?.id !== m.id || this.editing) return;
    this.session = new CommentSession(fresh, this.comments ?? [], mode);
    // A tile where there are none to be had (the BBS reader, a river column): split, the nearest.
    if (this.session.place === "tile" && !host.composerTile) this.session.place = "split";
    // From a comment mark (⏎, a click, or `m` while on one): the list opens on its thread.
    const on = mine && mode === "threads" && this.cur?.startsWith("comment:") ? this.cur.slice(8) : null;
    const t = on ? this.session.threads.findIndex(x => x.id === on) : -1;
    if (t >= 0) this.session.sel = t;
    const r = replyOn ? this.session.threads.findIndex(x => x.id === replyOn) : -1;
    if (r >= 0) { this.session.replyTo(r); this.session.fromReader = true; }
    // An Edit control (PIE-763): the same editor, on the comment's or reply's words; saved (or esc'd), back to reading.
    const ed = editOn ? this.session.threads.findIndex(x => x.id === editOn.thread) : -1;
    if (ed >= 0) {
      const why = this.session.editMark(ed, editOn!.reply);
      if (why) host.ctx.flash(why); else this.session.fromReader = true;
    }
    const p = this.session.passage;
    if (p && picked && fresh.text === m.text && picked.to > picked.from) { p.from = picked.from; p.to = picked.to; this.selection = null; }
    // Words selected in the reader (C, the passage toolbar's Comment and Ask): straight to writing at the passage, where
    // the person is reading (PIE-770), with what the toolbar starts it with. Without a selection C picks the passage first.
    const ask = mine && mode === "select" ? this.writeNext : null;
    this.writeNext = null;
    if (mine && mode === "select" && p && picked && fresh.text === m.text) {
      this.session.props = ask?.props ?? null;
      // Sent (or esc'd), the person is back reading, the thread where the composer was: as a reply from an expanded thread.
      this.session.fromReader = true;
      // A comment put aside here comes back as it was (its @name already in it): the toolbar's start isn't put over it.
      if (!this.session.write(USER) && ask?.text && this.session.composer?.restored === null) {
        this.session.writing?.replace(ask.text, USER);
        const d = this.session.composer;
        if (d) d.place(d.lines.length - 1, d.lines.at(-1)!.length);
      }
    }
    this.revealComposer = true;
    host.redraw();
  }

  /**
   * A comment on the whole note (PIE-846): the person's C with nothing selected, the byline's [comment], `comment.note`.
   * The note is read as the service has it now; the composer opens at the top of its body, where whole-note threads
   * are, and a comment put aside on the note comes back in it. Why it didn't open, else nothing.
   */
  async commentOnNote(host: SurfaceHost, actor: Actor = USER, still?: () => boolean): Promise<string | void> {
    const m = this.msg;
    if (!m || this.editing) return;
    if (this.session?.mode === "compose") return "a comment is being written here: send it (ctrl+s) or put it aside (esc twice) first";
    if (m.resource?.uncommentable) return m.resource.uncommentable;
    const read = await host.ctx.board.get(m.id);
    const fresh = read ? rereadResource(read, m) : read;
    if ((still && !still()) || this.msg?.id !== m.id || this.editing) return;
    if (!fresh || fresh.revision === undefined) return "can't comment: the outline didn't say which revision this note is at";
    this.msg = this.rereadNote(fresh);
    if (this.commentsFor !== m.id) await this.loadComments(host);
    if ((still && !still()) || this.msg?.id !== m.id || this.editing) return;
    // Another comment opened while this one was read (a second C, an act): the one being written stays.
    if ((this.session as CommentSession | null)?.mode === "compose") return "a comment is being written here: send it (ctrl+s) or put it aside (esc twice) first";
    const s = new CommentSession(fresh, this.comments ?? [], "threads");
    if (s.place === "tile" && !host.composerTile) s.place = "split";
    // Sent (or esc'd), the person is back reading, its thread at the top of the note.
    s.fromReader = true; s.startedBy = actor;
    const why = s.writeNote(actor);
    if (why) return why;
    this.session = s;
    this.revealComposer = true;
    host.redraw();
  }

  // ── the reader's modes: what takes its keys besides reading (src/surface/modes.ts) ──

  /** The edit: its draft session's keys, clicks, wheel and rows; leaving saves it or keeps it as unsent. */
  private draftMode(s: DraftSession): DraftMode {
    const d = s.draft;
    return {
      get keys() { return d.preview ? EDIT_PREVIEW_READER_KEYS : undefined; },
      name: "draft", of: d, session: s, holdsKeys: true, noun: "the edit",
      word: "edit",
      changed: revision => { if (!this.replyParent && !d.saving && revision !== d.base) d.changedElsewhere = true; },
      editing: () => true, covers: () => !this.replyParent,
      key: (k, host) => this.draftKey(k, host),
      click: (x, y, host) => elementEdit(d).on ? elementEdit(d).click(x, y, (action, args = {}) => { void this.runKey(action, args, host); }) : this.writeClick(d, x, y, host),
      press: (x, y, host, drag) => elementEdit(d).on ? elementEdit(d).click(x, y, (action, args = {}) => { void this.runKey(action, args, host); }, drag, true) : this.writePress(d, x, y, drag, host),
      wheel: (dir, host, at) => {
        if (this.replyParent && (!at || !wheelTarget(d, at.x, at.y))) return false;
        if (elementEdit(d).on) { void this.runKey("rich.scroll", { by: wheelRows(dir) }, host); return true; }
        return this.writeWheel(d, dir, at, this.editPreview.place !== "tile" || host.attachment === "edit-preview");
      },
      rows: (w, h, host) => { this.use(host); return this.msg ? this.renderDraft(d, this.msg, w, h, (host?.entered ?? host?.focused) === false && this.keepsOnFocusAway(), host) : null; },
      leave: async (host, actor) => {
        const r = await s.leave(actor);
        host.redraw();
        if (r.left === "kept") host.ctx.flash(r.said, 10000);
        return r;
      },
      unsaved: () => s.dirty,
      keep: () => [s.keep()],
      hint: () => d.preview && !completionOf(d) ? modeHint(EDIT_PREVIEW_READER_KEYS, action => NOTE_ACTIONS.def(action)) : this.replyParent ? `ctrl+s saves · Esc ${d.dirty ? "twice discards" : "discards"} · PgUp/PgDn scroll message · select then \" quotes` : (elementEdit(d).on ? "ctrl+o raw · Tab/↑↓ cells · alt+r/d row · alt+v/x column · " : "") + (imagePathAt(d.lines[d.row] ?? "", d.col) ? "ctrl+v makes that path a picture · " : "") + editHint(d, { save: "save", reload: d.conflict || d.changedElsewhere ? "reload" : null, follow: true }),
      state: () => `editing${d.dirty ? " · unsaved" : ""}`,
      describe: () => ({ ...s.describe(), previewPlace: this.editPreview.place, previewSplit: this.splits["edit-preview"], rich: elementEdit(d).on, writtenBy: writtenBy(d, "save") }),
    };
  }

  /**
   * The comment being written, drawn where the reader shows the note (PIE-770): its session, draft and frame for
   * renderEditor (src/surface/composer.ts draws it inline, floating, split or as a popup). Null while nothing is.
   */
  private composing(host?: SurfaceHost): { cs: CommentSession; d: Draft; f: EditFrame } | null {
    const cs = this.session, m = this.msg;
    if (!cs || cs.mode !== "compose" || !cs.composer || !m) return null;
    // Its preview draws pictures as the reader does (PIE-846), with the host's terminal.
    const f = cs.composerFrame((t, pw, links) => this.snippetDoc(t, pw, host, links, true));
    return f ? { cs, d: cs.composer, f: { ...f, look: host?.look?.values ?? this.lastLook?.values } } : null;
  }

  /** The comment being written is on the whole note, or answers a thread that is (PIE-846). */
  private writingOnWhole(): boolean {
    const t = this.session?.mode === "compose" ? this.session.target : null;
    return !!t && (t.kind === "note" || (t.kind !== "quote" && isWholeNote(t.thread)));
  }

  /** The words the comment is on, as offsets of the note's text (a reply: its thread's), or null when it has none placed. */
  private composerSpan(cs: CommentSession, m: Msg): [number, number] | null {
    const t = cs.mode === "compose" ? cs.target : null;
    if (!t || cs.msg.id !== m.id) return null;
    if (t.kind === "quote") return [t.passage.start, t.passage.start + Math.max(1, t.passage.quote.length)];
    if (t.kind === "note") return null;
    const c = (this.comments ?? []).find(x => x.id === t.thread.id) ?? t.thread;
    return c.start !== null && c.end !== null ? [c.start, Math.max(c.start + 1, c.end)] : null;
  }

  /** Commenting: picking a passage, writing (its own draft session), the thread list. */
  private commentMode(cs: CommentSession): CommentMode {
    // The comment's own tile (PIE-846) has its mouse (composerPointer): here, a press, a click and the wheel are the note's.
    const writing = () => (cs.mode === "compose" && cs.place !== "tile" ? cs.composer : null);
    const mode: CommentMode = {
      get keys() { return cs.mode === "compose" ? COMMENT_KEYS.map(row => row.key === "esc" && cs.dirty ? { ...row, label: "twice puts comment aside" } : row) : undefined; },
      name: "comment", of: cs, session: cs, holdsKeys: true, noun: "the comment", word: "comment",
      // The passage picker and the thread list are drawn in place of the note; the composer is drawn in it (PIE-770).
      // In its own tile (PIE-846) the list and the picker are drawn there, and the note here stays as it was.
      editing: () => true, covers: () => cs.mode !== "compose" && cs.place !== "tile",
      key: (k, host) => this.commentKey(cs, k, host),
      // Beside the box, a click on a link, a comment mark or back and forward goes there, asking first (PIE-785).
      click: (x, y, host) => {
        const r = this.boxRect;
        if ((cs.place === "floating" || cs.place === "popup") && r && (x < r.col || x >= r.col + r.cols || y < r.row || y >= r.row + r.rows)) return undefined;
        if (this.floatAt(x, y + (this.drawn?.heroRows ?? 0), host) === "comment" && this.sourcesMode) void this.runKey("sources.focus", { on: false }, host);
        const d = writing();
        return d ? this.writeClick(d, x, y, host) || this.followFromComposer(x, y, host) : cs.mode === "compose" && cs.place === "tile" ? this.followFromComposer(x, y, host) : false;
      },
      press: (x, y, host, drag) => {
        const d = writing();
        if (this.sourcesMode && this.boxRect && x >= this.boxRect.col && x < this.boxRect.col + this.boxRect.cols && y >= this.boxRect.row && y < this.boxRect.row + this.boxRect.rows) void this.runKey("sources.focus", { on: false }, host);
        if (!d) return false;
        // The floating box's top edge moves it, its ◢ corner and edges size it (PIE-785): comment.move, as ctrl+g's keys run it.
        if (this.frameDrag) { if (drag) this.dragFrame(x, y, host); return true; }
        const r = !drag && cs.place === "floating" ? this.boxRect : null, z = r && frameZone(r, x, y);
        if (z) { this.frameDrag = { target: "comment", zone: z, x, y, from: r! }; return true; }
        return this.writePress(d, x, y, drag);
      },
      // While a comment is written the wheel over its box scrolls the box's text or preview (PIE-846, its open completion's
      // candidates first); anywhere else it scrolls the note around it.
      wheel: (dir, _host, at) => {
        if (cs.mode === "compose" && cs.place === "tile") return false;
        const d = writing();
        if (!d) { cs.wheel(dir); return true; }
        const c = completerOf(d);
        if (c?.shown) { c.move(dir); return true; }
        return !!at && !!wheelTarget(d, at.x, at.y) && this.writeWheel(d, dir, at);
      },
      rows: (w, h, host) => { this.use(host); return this.msg && !(cs.place === "tile" && host?.composerTile) ? { lines: cs.render(w, h, subject(this.msg), (t, pw, links) => this.snippetDoc(t, pw, undefined, links)) } : null; },
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
      keep: () => (cs.writing ? [cs.writing.keep()] : []),
      hint: () => cs.busy ?? (cs.mode === "compose" && !(cs.composer && completionOf(cs.composer)) ? modeHint(mode.keys!, action => NOTE_ACTIONS.def(action)) : cs.hint()),
      state: () => (cs.mode === "compose" ? `writing${cs.dirty ? " · unsent" : ""}` : cs.mode === "select" ? "quoting" : "comments"),
      describe: () => cs.describe(),
      // A reply from an expanded thread landed: back to reading, the thread still open under its passage.
      ended: () => cs.finished,
    };
    return mode;
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
        // A value being typed keeps the reader's clicks, but for a candidate of its completion popup (PIE-626); a click on a row selects it (on its value, follows it).
        if (P.field) return completerOf(P.field.input)?.click(y, x) ?? false;
        const h = this.hitAt(x, y);
        if (!h || !("prop" in h)) return undefined;
        if (P.card) {
          // A click selects a field; a click on the selected one opens its picker (as enter does).
          const m = this.msg, f = m ? this.settingFields(m, P.card.schemas)[h.prop - 1] : undefined;
          if (!f) return false;
          if (P.card.sel === h.prop - 1) void this.runKey("settings.set", { key: f.prop.key }, host);
          else { P.card.sel = h.prop - 1; P.card.note = ""; }
          host.redraw();
          return true;
        }
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
      hint: () => (P.card ? P.card.hint() : P.hint()),
      state: () => (P.card ? "settings" : P.field ? "editing a property" : "properties"),
      describe: () => {
        const m = this.msg;
        if (m && P.card) {
          return { open: "settings", schemas: P.card.schemas.map(s => s.id), selected: P.card.sel + 1, note: P.card.note || null, editing: null,
            fields: this.settingFields(m, P.card.schemas).map(f => ({ n: f.n, section: P.card!.schemas[f.section]!.id, key: f.prop.key, type: f.prop.type, value: f.value, ...(f.prop.default !== undefined ? { default: f.prop.default } : {}) })), rows: [] };
        }
        return m ? {
          open: P.full ? "full" : "inline", selected: P.sel + 1, note: P.note || null,
          editing: P.field ? { n: P.field.row.n, key: P.field.row.key, text: P.field.input.text, revision: P.field.revision, changedElsewhere: P.field.changedElsewhere, note: P.field.note || null } : null,
          rows: this.rows(m).map(r => describeRow(r, this.src, m.text)),
        } : null;
      },
    };
  }

  // ── the inline lists (PIE-693, PIE-747): a ::links component, an extension's list view; their rows, picks, the person in one ──

  /**
   * An extension's `list` view drawn (PIE-747): the rows are the primitive's, the view is this reader's (`#n` among the
   * lists the note draws), and each row is the element its one activation makes it: a block or Resource it opens, an
   * action line it presses, text it copies or puts in the person's draft.
   */
  private viewList(node: ListPrimitive, width: number, run: (act: string) => LinkTarget, lb: LinkBlocksEnv | undefined, drawn: Link[], markdown: (text: string) => string[]): string[] {
    if (!lb) return listRowsOf(node).flatMap(r => listRowLines(r, { cols: width, lines: 2 }));
    const n = ++(lb.drawn ??= { n: 0 }).n, key = `#${n}`;
    const view = this.listFor(key, true, "list"), entered = this.listIn === key;
    view.set(listRowsOf(node));
    const previewing = node.preview !== undefined && node.preview !== "none" && view.rows.some(r => r.preview);
    const tag = (row: ListViewRow, x: string): string => {
      const a = activationOf(row);
      if (!a) return x;
      const at = { listRow: { key, row: row.id } };
      const to: LinkTarget = a.kind === "open" ? (isResourceRef(a.value as string) ? { resourceRef: a.value as string, label: a.value as string, role: "row" } : { block: a.value as string, role: "row" })
        : a.kind === "run" ? run(actionLine({ action: (a.value as { action: string }).action, args: (a.value as { args?: Record<string, string> }).args }))
        : { role: "row", label: row.label, listText: a.kind === "copy" ? { copy: a.value as string } : { insert: a.value as string } };
      return tagged(drawn, { ...to, ...at }, x);
    };
    const drawing = view.draw({
      cols: width, focused: entered, selection: entered || previewing, tag, empty: node.empty ?? "nothing here",
      ...(previewing ? { preview: { side: node.preview!, of: (row: ListViewRow, w: number) => {
        const p = row.preview;
        return !p ? null : "block" in p ? lb.preview?.(p.block, w) ?? null : markdown(p.markdown);
      } } } : {}),
    });
    lb.seen?.({ n, key, title: `list ${n}`, view, entered, detail: { preview: null } });
    // The frame's control, above the rows: ⏎ in (or esc out), unless the view said the list takes no keys.
    const control = node.enter !== false && lb.control ? [" ".repeat(Math.max(0, width - 7)) + lb.control(key, entered ? "esc out" : "⏎ in")] : [];
    return [...control, ...drawing.lines];
  }

  /** The list the reader keeps for component `key`, made when first drawn. `narrows`: whether the view narrows its rows by a typed filter (a links component's model does that itself). */
  listFor<S = unknown>(key: string, narrows = false, signature = ""): ListView<S> {
    let v = this.listViews.get(key);
    // A `#n` key is a place: the component drawn there now is the same list only while it is the same kind of thing.
    if (v && (v.narrows !== narrows || (key.startsWith("#") && v.signature !== signature))) { if (this.listIn === key) this.leaveList(key); v = undefined; }
    if (!v) { this.listViews.set(key, v = new ListView<S>(key, narrows)); v.signature = signature; }
    return v as ListView<S>;
  }

  /** The lists the last layout drew, numbered in drawing order. */
  get listsDrawn(): ListHandle<any>[] { return this.linkBlocksDrawn; }

  /**
   * The list of this reader the actions name, `named` as `list.*` takes it (its number, `^name` or title); left out, the
   * one the person is in, else the one the [ ] position is in, else the note's only one.
   */
  listNamed(named?: string): ListHandle<any> { return listNamed(this.listHost(), named); }

  /** The element drawn for row `row` of list `key`, and its number among the elements (from 1), or null. */
  linkRowElement(key: string, row: string): { e: Element; n: number; row?: number } | null {
    const i = this.elems.findIndex(e => e.link?.listRow?.key === key && e.link.listRow.row === row);
    if (i >= 0) return { e: this.elems[i]!, n: i + 1 };
    for (const [listKey, list] of this.inlineLists) {
      const index = list.rows.findIndex(r => r.target.listRow?.key === key && r.target.listRow.row === row);
      const n = this.elems.findIndex(e => e.link?.inlineList?.key === listKey);
      if (index >= 0 && n >= 0) return { e: this.inlineRowElement(this.elems[n]!, index), n: n + 1, row: index + 1 };
    }
    return null;
  }

  /**
   * The current element is an inline list row: the host shows its note where this reader's selection goes (a
   * preview following the reader, its preview link: PIE-794), as a links tile's selection does. Read only.
   */
  private selectedElement(): Element | undefined {
    const drawn = this.elems.find(e => e.key === this.cur);
    if (drawn) return drawn;
    // Several key reports may arrive before a repaint exposes the newly selected row.
    for (const [key, list] of this.inlineLists) {
      const row = list.rows.find(r => inlineRowKey(key, r.target) === this.cur);
      const place = row && this.elems.find(e => e.link?.inlineList?.key === key);
      if (row && place) return { ...place, key: this.cur!, label: row.label, link: row.target };
    }
    return undefined;
  }

  previewRow(host: SurfaceHost) {
    const selected = this.cur;
    const target = this.selectedElement()?.link;
    if (!target?.block || target.role !== "row" || !host.preview) return;
    void host.ctx.board.get(target.block).then(m => { if (m && this.cur === selected) host.preview!(m); }, () => {});
  }

  /** The person's pick in list `l` moves to row `row`: the [ ] position goes with it, so the ruler and the preview agree. */
  selectListRow(l: ListHandle<any>, row: string) {
    l.view.pick(PERSON, row);
    const at = this.linkRowElement(l.key, row);
    if (at) this.setElem(at.e);
    this.reveal = true;
  }

  /** The person goes into list `l` (its rows take j k ⏎ / esc), or comes out of it. */
  enterList(l: ListHandle<any>, on: boolean) {
    if (!on) { this.leaveList(l.key); this.letGo(); return; }
    this.modes.push(this.listMode(l.key, l.title));
    const first = l.view.picked(PERSON) ?? l.view.visible().find(selectable);
    if (first) this.selectListRow(l, first.id);
  }
  /** Out of the list the person is in (any, or only `key`): its typed filter goes with it. */
  private leaveList(key?: string) {
    const was = this.listIn;
    if (!was || (key && key !== was)) return;
    this.modes.drop("list");
    this.listViews.get(was)?.stopTyping(false);
  }

  /** The list the person went into: j k Home End move, ⏎ opens, / filters, esc comes out; any other key leaves it and goes on. */
  private listMode(list: string, title: string): ListMode {
    return {
      name: "list", of: { list }, list, word: "list",
      // Not a session: it holds no note. Its keys come first while it's open; the screen's (Tab, ^W, digits) stay the screen's.
      holdsKeys: false, editing: () => false, covers: () => false,
      key: (k, host) => this.listKey(list, k, host),
      click: (x, y) => {
        const h = this.hitAt(x, y);
        // A click in its own rows or its control is reading's (a row selects, the control comes out); anywhere else leaves it.
        if (!(h && "link" in h && h.link.listRow?.key === list)) this.leaveList();
        return undefined;
      },
      rows: () => null,
      leave: async () => { this.leaveList(); return { left: "nothing" }; },
      hint: () => this.listViews.get(list)?.typing ? "type to filter the list · ⏎ keep · esc clear" : `${title} · j k row · ⏎ open · alt+⏎ new detail · / filter · esc out`,
      state: () => "in a list",
      describe: () => ({ list, title, selected: this.listViews.get(list)?.picked(PERSON)?.id ?? null, typing: this.listViews.get(list)?.typing?.text ?? null }),
    };
  }

  private listKey(list: string, k: Key, host: SurfaceHost): boolean {
    const l = this.listsDrawn.find(x => x.key === list);
    if (!l) { this.leaveList(); return this.key(k, host); }
    const view = l.view, T = view.typing;
    if (T) {
      // Typing a filter: letters go into it and the list follows; ⏎ keeps it, esc goes back to what it was.
      if (k.kind === "enter") view.stopTyping(true);
      else if (k.kind === "esc") view.stopTyping(false);
      else if (!T.take(k)) return true;
      host.redraw();
      return true;
    }
    const n = view.visible().filter(selectable).length, c = ch(k);
    const to = (i: number) => { if (n && i >= 0 && i < n) void this.runList("list.pick", { list: String(l.n), n: i + 1 }, host); return true; };
    if (isDown(k) || isUp(k)) {
      void this.runKey("reading.step", { by: isDown(k) ? 1 : -1 }, host);
      return true;
    }
    if (k.kind === "home") return to(0);
    if (k.kind === "end") return to(n - 1);
    if (k.kind === "enter" || k.kind === "alt-enter") { if (n) void this.runList("list.open", { list: String(l.n), ...(k.kind === "alt-enter" ? { where: "new" } : {}) }, host); return true; }
    if (c === "/") { void this.runList("list.filter", { list: String(l.n) }, host); return true; }
    if (k.kind === "esc") { void this.runList("list.enter", { list: String(l.n), on: false }, host); return true; }
    // Any other key: out of the list, and the key does what it does in the reader.
    this.leaveList();
    host.redraw();
    return this.key(k, host);
  }

  /** A list action (list.pick, list.open, …), through the host's dispatcher, else the reader's own. */
  runList<K extends ListActionName>(name: K, args: ArgsOfSet<typeof LISTVIEW_ACTIONS>[K], host: SurfaceHost, quiet: boolean | ((why: string) => string | null) = false): Promise<unknown> {
    return host.pressSet ? host.pressSet(LISTVIEW_ACTIONS, name, args as Record<string, unknown>, quiet, host) : this.alone(host).pressIn(LISTVIEW_ACTIONS, name, args as Record<string, unknown>, undefined, quiet);
  }

  /** This reader's lists as the actions run over them (the registration builds it with the host the key or click was given). */
  listHost(host?: SurfaceHost): ListHost {
    const here = () => { if (!host) throw new ActionRefused("this list action needs the reader's host"); return host; };
    return {
      lists: () => this.listsDrawn,
      current: () => this.listIn ?? this.inView()?.link?.listRow?.key ?? null,
      none: "this note draws no list (a ::links component, or an extension's list view)",
      picked: (l, row) => { this.selectListRow(l, row.id); this.previewRow(here()); },
      open: (l, row, where, actor, standing) => this.openListRow(l, row, where, actor, here(), standing),
      enter: (l, on) => { if (on || this.listIn === l.key) this.enterList(l, on); },
      type: l => { if (this.listIn !== l.key) this.enterList(l, true); l.view.startTyping(filterLine); },
      redraw: () => host?.redraw(),
    };
  }

  /** Open a row of list `l` for real: the element it is drawn as, opened as `element.open` opens it (fresh: alt+⏎). */
  private async openListRow(l: ListHandle<any>, row: ListViewRow<any>, where: "home" | "new", actor: Actor, host: SurfaceHost, standing: boolean): Promise<unknown> {
    const at = this.linkRowElement(l.key, row.id);
    if (!at) throw new ActionRefused(`${row.label} isn't drawn in ${l.title} now`);
    // A row that runs an action line is a press (button.press), as whoever asks.
    if (at.e.link?.press) return NOTE_ACTIONS.run("button.press", { n: at.n }, { surface: this, host, standing }, actor);
    return NOTE_ACTIONS.run("element.open", { n: at.n, ...(at.row !== undefined ? { row: at.row } : {}), ...(where === "new" ? { fresh: true } : {}) }, { surface: this, host, standing }, actor);
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

  /**
   * An edit or a comment the person is writing here, left open when their keys move to another tile (PIE-785 for a
   * comment, PIE-812 for an edit): it stays on screen as it was (its cursor, selection and undo: the same draft session),
   * and is theirs again the moment this reader has the keys back. Only the person's own, and not while it's landing.
   * Save, esc or another open in this reader still end it, by the draft session's rules.
   */
  keepsOnFocusAway(): boolean {
    if (this.modes.leaveRefusal()) return false;
    const d = this.drafting;
    if (d) return d.openedBy.kind === "user" && !d.busy;
    const cs = this.session, w = cs?.writing;
    return !!cs && cs.mode === "compose" && !!w && w.openedBy.kind === "user" && !cs.busy;
  }

  /**
   * The person asked to go elsewhere (`name` with `args`) while a comment of theirs is unsent here (PIE-785): asked in
   * the power bar (src/bar/ask.ts) instead of refused: save and continue / keep writing / discard; putting the bar away
   * keeps writing. Null when there's nothing to ask (no comment written, or `actor` is an agent: an agent's action never
   * asks the person, and never takes their keys).
   */
  askLeave(name: LeaveAsk["name"], args: Record<string, unknown>, actor: Actor, host: SurfaceHost, elem?: string): Promise<unknown> | null {
    const cs = this.session;
    if (actor.kind === "agent" || !cs || cs.mode !== "compose" || !cs.writing) return null;
    // Nothing typed yet: nothing to lose, so it closes and the reader goes.
    if (!cs.dirty && !cs.busy) { cs.writing.close(); this.closeSession(); return null; }
    if (cs.busy) throw new ActionRefused(`${cs.busy} · wait for it to land`);
    const what = cs.target?.kind === "reply" ? "reply" : cs.target?.kind === "edit" ? "edit" : cs.props?.kind === "question" ? "question" : "comment";
    this.modes.drop("grip");
    const ask: LeaveAsk = { what, name, args, ...(elem ? { elem } : {}) };
    this.leaving = ask;
    const choices: LeaveChoice[] = ["save", "keep", "discard"];
    return askInBar(host.ctx as never, `about to leave an unsent ${what}`, [{
      name: "choice", type: "choice", label: "what happens to it", choices, says: LEAVE_SAYS,
      description: "Save and continue keeps it as unsent where it was written (C and the passage bring it back) and goes; keep writing goes back to it; discard lets it go (a copy stays on disk) and goes. Esc keeps writing.",
    }], {}, actor, answers => {
      // Answered late (the person went back to typing, or another question replaced it): nothing waits on it any more.
      if (this.leaving !== ask || this.session !== cs) throw new ActionRefused(`that question is over · the ${what} is as it was`);
      if (!answers.choice) { this.leaving = null; throw new ActionRefused(`the ${what} isn't sent · ctrl+s sends it, esc twice puts it aside`); }
      return this.runKey("comment.leaving", { choice: answers.choice }, host);
    });
  }

  /**
   * The person's answer (comment.leaving): `save` keeps the comment as unsent where it was written (opening it again
   * brings it back) and goes where they asked; `keep` goes back to writing; `discard` lets it go (a copy stays on disk)
   * and goes.
   */
  async answerLeave(choice: LeaveChoice, host: SurfaceHost): Promise<{ choice: LeaveChoice; said?: string; then?: unknown }> {
    const ask = this.leaving, cs = this.session, w = cs?.writing;
    if (!ask || !cs || cs.mode !== "compose" || !w) throw new ActionRefused("nothing is being asked here: the choice comes up when you follow a link while a comment is unsent");
    this.leaving = null;
    if (choice === "keep") { this.revealComposer = true; host.redraw(); return { choice }; }
    let said: string | undefined;
    if (choice === "save") { const r = await w.leave(USER); said = leaveSaid(r) ?? undefined; }
    else said = w.discard().said;
    this.closeSession();
    host.redraw();
    if (said) host.ctx.flash(said, 8000);
    // An element is found again by its key: what's drawn above it may have changed (the kept comment's line).
    const n = ask.elem ? this.elems.findIndex(e => e.key === ask.elem) + 1 : 0;
    if (ask.elem && !n) return { choice, ...(said ? { said } : {}), then: "the element isn't drawn any more" };
    const then = await this.runKey(ask.name, (n ? { ...ask.args, n } : ask.args) as never, host);
    return { choice, ...(said ? { said } : {}), then };
  }

  /** ctrl+g in a comment being written: its box floats, and the arrows move it and shift+arrows size it until ⏎ or esc (PIE-785). */
  private gripMode(cs: { place: AttachedPlace; float: FloatRect | null; mode?: string }, target: "comment" | "sources" = "comment"): GripMode {
    const move = (args: ComposerMove, host: SurfaceHost) => void this.runKey(target === "comment" ? "comment.move" : "sources.move", args, host, true);
    const side = (to: "left" | "right" | "up" | "down", host: SurfaceHost) => void this.runKey(target === "comment" ? "comment.place" : "sources.place", { place: "tile", side: to }, host, true);
    const tiled = () => cs.place === "tile";
    return {
      name: "grip", of: cs, holdsKeys: true, word: "composer move",
      editing: () => false, covers: () => false,
      ended: () => (cs.place === "tile" ? false : (target === "comment" && cs.mode !== "compose") || cs.place !== "floating"),
      key: (k, host) => {
        const c = ch(k);
        // In its own tile (PIE-846): the arrows put it on that side of its reader; its border sizes it (or ^W < > + -).
        if (tiled()) {
          if (k.kind === "left" || c === "h") side("left", host);
          else if (k.kind === "right" || c === "l") side("right", host);
          else if (k.kind === "up" || c === "k") side("up", host);
          else if (k.kind === "down" || c === "j") side("down", host);
          else if (k.kind === "enter" || k.kind === "esc" || (k.kind === "char" && k.ctrl && k.ch === "g")) { this.modes.drop("grip"); host.redraw(); }
          else { this.modes.drop("grip"); return this.modes.key(k, host) ?? false; }
          return true;
        }
        const step = (dx: number, dy: number) => move({ dx, dy }, host), size = (dcols: number, drows: number) => move({ dcols, drows }, host);
        const shift = "shift" in k && !!k.shift;
        if (k.kind === "left" || c === "h") shift ? size(-2, 0) : step(-2, 0);
        else if (k.kind === "right" || c === "l") shift ? size(2, 0) : step(2, 0);
        else if (k.kind === "up" || c === "k") shift ? size(0, -1) : step(0, -1);
        else if (k.kind === "down" || c === "j") shift ? size(0, 1) : step(0, 1);
        else if (c === "H") size(-2, 0);
        else if (c === "L") size(2, 0);
        else if (c === "K") size(0, -1);
        else if (c === "J") size(0, 1);
        else if (c === "0") move({ reset: true }, host);
        else if (k.kind === "enter" || k.kind === "esc" || (k.kind === "char" && k.ctrl && k.ch === "g")) { this.modes.drop("grip"); host.redraw(); }
        else { this.modes.drop("grip"); return this.modes.key(k, host) ?? false; }
        return true;
      },
      click: () => { this.modes.drop("grip"); return undefined; },
      rows: () => null,
      leave: async () => { this.modes.drop("grip"); return { left: "nothing" }; },
      hint: () => (tiled() ? "moving the attachment round its note · ← → ↑ ↓ or h j k l: that side · drag its border (or ^W < > + -) to size it · ⏎ done" : "moving the attachment · ← → ↑ ↓ or h j k l move · shift+arrows or H J K L size · 0 its usual place · ⏎ done"),
      state: () => "moving the comment",
      describe: () => ({ moving: true, float: cs.float }),
    };
  }

  /** Open moving by keys (ctrl+g, comment.grip): the box floats first if it was elsewhere. */
  grip(host: SurfaceHost) {
    const cs = this.session;
    if (!cs || ((cs.mode !== "compose" || !cs.composer) && cs.place !== "tile")) throw new ActionRefused("no comment is being written here; C on selected words (or passage.act action=comment) opens one");
    // In its own tile it moves round its reader instead (PIE-846); anywhere else it floats to move.
    if (cs.place !== "floating" && cs.place !== "tile") { cs.place = "floating"; cs.float = null; }
    this.modes.push(this.gripMode(cs));
    host.redraw();
  }

  /**
   * The floating composer moved or sized (comment.move, PIE-785): by steps (`dx` `dy` `dcols` `drows`), to a place (`row`
   * `col` `cols` `rows`, the reader's cells), or back to its usual place (`reset`). Kept inside the reader; only for this
   * comment while it's written.
   */
  moveComposer(a: ComposerMove, host: SurfaceHost): FloatRect | null {
    const cs = this.session;
    if (!cs || cs.mode !== "compose" || !cs.composer) throw new ActionRefused("no comment is being written here; C on selected words (or passage.act action=comment) opens one");
    if (cs.place !== "floating") throw new ActionRefused(`the comment is ${cs.place}, not floating · comment.place place=floating (ctrl+o) floats it, ctrl+g floats and moves it`);
    if (a.reset) { cs.float = null; this.revealComposer = true; host.redraw(); return null; }
    const was = cs.float ?? this.boxRect, room = this.boxRoom;
    // Not drawn yet (opened again after a handover, PIE-847): a whole rect is taken as it is, kept on the reader as it's drawn.
    if ((!was || !room) && a.row !== undefined && a.col !== undefined && a.cols !== undefined && a.rows !== undefined) {
      cs.float = { row: a.row, col: a.col, cols: a.cols, rows: a.rows };
      host.redraw();
      return cs.float;
    }
    if (!was || !room) throw new ActionRefused("the comment isn't drawn yet; say col, row, cols and rows, or try again once it is");
    const next = moveFloat(was, a, room);
    cs.float = next;
    host.redraw();
    return next;
  }

  /** A drag from the floating box's top edge or ◢ corner (PIE-785): comment.move to where the pointer is. */
  private dragFrame(x: number, y: number, host: SurfaceHost) {
    const g = this.frameDrag!, f = g.from, dx = x - g.x, dy = y - g.y;
    const to = g.zone.kind === "move" ? { row: f.row + dy, col: f.col + dx, cols: f.cols, rows: f.rows }
      : { row: f.row, col: f.col, cols: f.cols + (g.zone.cols ? dx : 0), rows: f.rows + (g.zone.rows ? dy : 0) };
    const now = g.target === "edit-preview" ? this.editPreview.float ?? this.editPreview.frame : g.target === "sources" ? this.sourcesMode?.float ?? this.sourcesMode?.frame : this.session?.float ?? this.boxRect;
    if (now && now.row === to.row && now.col === to.col && now.cols === to.cols && now.rows === to.rows) return;
    void this.runKey(g.target === "edit-preview" ? "edit.preview.move" : g.target === "sources" ? "sources.move" : "comment.move", to, host, true);
  }

  /**
   * A click beside the composer's box on something that goes elsewhere (a link, a row, an embed, a comment mark, back or
   * forward): that element's action as the person, which asks first while the comment is unsent (askLeave, PIE-785).
   */
  private followFromComposer(x: number, y: number, host: SurfaceHost): boolean {
    const b = this.boxRect;
    if (b && x >= b.col && x < b.col + b.cols && y >= b.row && y < b.row + b.rows) return false;
    const h = this.hitAt(x, y);
    if (!h) return false;
    if ("history" in h) { void this.runKey(historyAction(h.history), {}, host); return true; }
    if (!("link" in h || "thread" in h)) return false;
    const e = h.elem ? this.elems.find(x => x.key === h.elem) : undefined;
    if (e && (e.kind === "link" || e.kind === "row" || e.kind === "embed" || e.kind === "comment")) { void this.runKey("element.open", { n: this.elems.indexOf(e) + 1 }, host); return true; }
    if (e || !("link" in h) || h.value !== undefined) return false;
    const i = this.links.findIndex(l => sameLink(l, h.link));
    if (i < 0 || h.link.role) return false;
    void this.runKey("link.follow", { n: i + 1 }, host);
    return true;
  }

  /** The comment session's keys: its commands are actions (PIE-506); picking, moving and typing are its own. */
  commentEscape(host: SurfaceHost) { return this.session ? this.commentKey(this.session, { kind: "esc" }, host, true) : false; }

  private commentKey(s: CommentSession, k: Key, host: SurfaceHost, escape = false): boolean {
    if (!escape && s.mode === "compose" && s.composer && !s.busy && !s.composer.busy && !completerOf(s.composer)?.shown) {
      const binding = modeBinding(COMMENT_KEYS, k);
      if (binding) { void this.runKey(binding.action as keyof NoteActionArgs, binding.args as never, host, true); return true; }
    }
    const writing = s.writing;
    // Back to writing: a "leave it unsent?" asked in the power bar (PIE-785) is over, and its answer does nothing.
    this.leaving = null;
    // cmd+c in the comment being written copies its selection (the draft's copy, as in an edit).
    if (s.mode === "compose" && s.composer && isCopyKey(k)) { void this.runKey("draft.copy", {}, host); return true; }
    // ctrl+o: the composer somewhere else (inline, floating, split, popup: PIE-770); the thread list into its own tile
    // beside the note and back over it (PIE-846).
    if (s.mode !== "compose" && !s.busy && k.kind === "char" && k.ctrl && k.ch === "o" && host.composerTile) { void this.runKey("comment.place", { place: s.place === "tile" ? "inline" : "tile" }, host, true); return true; }
    if (s.mode !== "compose" && s.place === "tile" && !s.busy && k.kind === "char" && k.ctrl && k.ch === "g") { void this.runKey("comment.grip", {}, host, true); return true; }
    // Typing brings an inline composer (rows of the note) back into view after the wheel took the note elsewhere. A
    // floating, split or popup one is in view already: the note stays where it was scrolled (PIE-846).
    if (s.mode === "compose" && s.place === "inline") this.revealComposer = true;
    const verb = s.mode === "threads" && !s.busy && s.threads[s.sel] ? ATTENTION_KEYS[ch(k) ?? ""] : undefined;
    if (verb) { void this.runKey(verb, { thread: s.threads[s.sel]!.id, ...(ch(k) === "T" ? { remove: true } : {}) }, host, true); return true; }
    // e edits the current thread's comment in the same editor (PIE-763); a reply's words: its [Edit] on the expanded thread.
    if (s.mode === "threads" && !s.busy && s.threads[s.sel] && ch(k) === "e") { void this.runKey("comment.edit", { thread: s.threads[s.sel]!.id }, host, true); return true; }
    // q quotes the current thread (or the ones space picked) into a new block; space picks.
    if (s.mode === "threads" && !s.busy && s.threads[s.sel] && ch(k) === "q") { void this.runKey("quote", {}, host, true); return true; }
    if (s.mode === "threads" && !s.busy && s.threads[s.sel] && ch(k) === " ") { void this.runKey("thread.pick", {}, host, true); return true; }
    if (s.key(k, this.commentEnv(host)) === "close" || s.finished) void this.runKey("comment.close", {}, host);
    // A comment closed by esc, esc is put aside, like an edit: said where, and how it comes back.
    if (k.kind === "esc" && writing && s.writing !== writing) host.ctx.flash(writing.closedWith || "closed the comment", 8000);
    host.redraw();
    return true;
  }

  /** A click in text being written (an edit's or a comment's): a completion candidate, the preview control, or the cursor placed. */
  private writeClick(d: Draft, x: number, y: number, host: SurfaceHost): boolean {
    if (d.busy) return false;
    const p = this.editPreview.rect;
    if (d === this.draft && d.preview && (this.editPreview.place !== "tile" || host.attachment === "edit-preview") && p && x >= p.col && x < p.col + p.cols && y >= p.row && y < p.row + p.rows) {
      if (y === p.row) void this.runKey("placement.menu", { target: "edit-preview" }, host, true);
      else { const link = d.frame?.links?.find(l => l.row === y && x >= l.from && x < l.to); if (link) { const ref = refOfLink(link.target); if (ref) void this.runKey("edit.follow", { ref }, host); } }
      return true;
    }
    if (completerOf(d)?.click(y, x, text => host.ctx.copy?.(text, "component preview"))) return true;
    // Beside a composer's box (floating, popup, split: PIE-770) a click is nobody's: not a candidate, not the cursor.
    const f = d.frame;
    if (f && (x < f.col - 1 || x > f.col + f.cols)) return false;
    if (completionOf(d)) return false;
    const follow = (to?: Link) => { const ref = to && refOfLink(to); if (!to || ref) void this.runKey("edit.follow", ref ? { ref } : {}, host); };
    this.editPress = editorClick(d, x, y, false, USER, { pick: () => void this.runKey("draft.pick", {}, host), copy: () => void this.runKey("draft.copy", {}, host), place: () => void this.runKey("placement.menu", { target: "comment" }, host, true), lands: () => void this.runKey("note.move", {}, host, true), follow }, host.freshClick ? 8 : 0, d !== this.draft || this.editPreview.place !== "tile");
    if (this.editPress) host.redraw();
    return this.editPress;
  }
  /**
   * Follow link `l` from the edit or comment being written (`edit.follow`, PIE-592): where a reader's link opens, which
   * for a reader holding an edit is beside it (the desk's `besideEdit`); the draft and its cursor stay as they were.
   */
  followFromDraft(l: Link, host: SurfaceHost): Promise<Msg | Outside | TagList | null> {
    return this.followTarget(l, host, { link: true });
  }
  /** The draft being written here, an edit's or a comment's, or null. */
  get writingDraft(): Draft | null {
    return (this.drafting ?? (this.session?.mode === "compose" ? this.session.writing : null) ?? this.listEditor.field?.session)?.draft ?? null;
  }

  /** A double click in a draft selects the word under the cursor, a triple click its line: two draft.place, as a drag would. */
  private async selectInDraft(d: Draft, n: number, host: SurfaceHost) {
    const line = d.lines[d.row] ?? "";
    let from = 0, to = line.length;
    if (n === 2) {
      const word = /[\p{L}\p{N}_\-]/u, at = Math.min(d.col, line.length);
      from = at; to = at;
      while (from > 0 && word.test(line[from - 1]!)) from--;
      while (to < line.length && word.test(line[to]!)) to++;
      if (from === to) return;
    }
    const row = d.row + 1;
    await this.runKey("draft.place", { line: row, col: from + 1 }, host);
    await this.runKey("draft.place", { line: row, col: to + 1, extend: true }, host);
  }

  /**
   * The comment being written as its own tile draws it (PIE-846, place `tile`): the one edit control (renderEditor) in
   * the tile's `w` × `h` cells, the passage quoted above the text as split and popup quote it, its preview's pictures
   * placed. Null when nothing is being written here in a tile.
   */
  composerTile(w: number, h: number, host: SurfaceHost): SurfaceView | null {
    const cs = this.session;
    if (!cs || cs.place !== "tile" || !this.msg) return null;
    const rect = attachedRect("tile", w, h);
    w = rect.cols; h = rect.rows;
    // Its thread list (or the passage picker) there too: reading the comments beside the note (PIE-846).
    if (cs.mode !== "compose") {
      this.use(host);
      const lines = cs.render(w, h, subject(this.msg), (t, pw, links) => this.snippetDoc(t, pw, host, links, true)).map(l => pad(l, w) + RESET);
      while (lines.length < h) lines.push("");
      return { lines, placements: [] };
    }
    const c = this.composing(host);
    if (!c) return null;
    const lines = renderEditor(c.d, c.f, w, h).map(l => pad(l, w) + RESET);
    while (lines.length < h) lines.push("");
    return this.withPlacementMenu({ lines, placements: previewPictures(c.d, 0, h) }, w, h, "comment");
  }

  /**
   * The mouse in the comment's own tile (PIE-846), at `x`, `y` in it: a press puts the cursor there and a drag selects,
   * the release is a click (a control, a candidate, a link in the preview) and copies what a drag selected, the wheel
   * scrolls the text or its preview. True when it was the comment's.
   */
  composerPointer(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, host: SurfaceHost): boolean {
    if (this.placementMenu) { if (k.action === "up") this.modes.click(x, y, host); return true; }
    const cs = this.session;
    if (cs?.place === "tile" && cs.mode !== "compose" && (k.action === "wheel-up" || k.action === "wheel-down")) { cs.wheel(k.action === "wheel-down" ? 1 : -1); host.redraw(); return true; }
    const d = cs?.mode === "compose" && cs.place === "tile" ? cs.composer : null;
    if (!d) return false;
    if (k.action === "wheel-up" || k.action === "wheel-down") { this.writeWheel(d, k.action === "wheel-down" ? 1 : -1, { x, y }); host.redraw(); return true; }
    if (k.action === "down") { this.tileDrag = false; this.writePress(d, x, y, false); host.redraw(); return true; }
    if (k.action === "drag") { this.tileDrag = true; this.writePress(d, x, y, true); host.redraw(); return true; }
    if (k.action === "up") {
      if (!this.tileDrag) this.writeClick(d, x, y, host);
      else if (d.selectedText()?.trim() && copyOnSelect()) void this.runKey("draft.copy", {}, host);
      this.tileDrag = false;
      host.redraw();
      return true;
    }
    return false;
  }
  private attachmentTileHost(target: "comment" | "sources" | "list-preview" | "edit-preview", host?: SurfaceHost): AttachedTileHost | undefined {
    if (!host || !(target === "edit-preview" ? host.editPreviewTile : target === "list-preview" ? host.listPreviewTile : target === "comment" ? host.composerTile : host.sourcesTile)) return undefined;
    return {
      open: (on, side) => target === "edit-preview" ? host.editPreviewTile!(on, side) : target === "list-preview" ? host.listPreviewTile!(on, side) : target === "comment" ? host.composerTile!(on, this.session?.startedBy.kind === "user", side) : host.sourcesTile!(on, side),
      exists: target === "edit-preview" ? host.hasEditPreviewTile : target === "list-preview" ? host.hasListPreviewTile : target === "comment" ? host.hasComposerTile : host.hasSourcesTile,
      changed: why => { if (why) host.ctx.flash(why); host.redraw(); },
    };
  }

  async placeAttachment(target: "comment" | "sources" | "list-preview" | "edit-preview", place: AttachedPlace, host: SurfaceHost, side?: AttachedSide) {
    const owner = target === "edit-preview" ? this.editPreview : target === "list-preview" ? this.listPreview : target === "comment" ? this.session! : this.sourcesMode!;
    await this.attachmentTiles[target].place(owner, place, this.attachmentTileHost(target, host), side);
  }

  /** A drag in the comment's own tile is selecting (its release copies, never clicks). */
  private tileDrag = false;

  /** A press puts the cursor there; a drag from it selects (Draft's own selection). */
  private writePress(d: Draft, x: number, y: number, drag: boolean, host?: SurfaceHost): boolean {
    if (completerOf(d)?.previewPress(x, y, drag)) return true;
    const p = d === this.draft && d.preview && (this.editPreview.place !== "tile" || host?.attachment === "edit-preview") ? this.editPreview.rect : null;
    if (p && x >= p.col && x < p.col + p.cols && y >= p.row && y < p.row + p.rows) return false;
    return !d.busy && (drag || !completionOf(d)) && editorClick(d, x, y, drag, USER, undefined, 0, d !== this.draft || this.editPreview.place !== "tile");
  }
  /** The preview under the pointer owns the wheel before draft-local completion; elsewhere completion or the draft scrolls. */
  private writeWheel(d: Draft, dir: 1 | -1, at?: { x: number; y: number }, previewHere = true): boolean {
    const preview = previewHere && !!at && wheelTarget(d, at.x, at.y) === "preview";
    const c = completerOf(d);
    if (!preview && c?.shown) { if (at && c.overPreview(at.x, at.y)) c.scrollPreview(wheelRows(dir)); else c.move(dir); return true; }
    if (!d.busy) void DRAFT_ACTIONS.run("draft.scroll", { by: wheelRows(dir), ...(preview ? { preview: true } : {}) }, d, USER);
    return true;
  }

  /** A right-click at the surface's cell `x`, `y` is an element's own (a step's box, a callout's type: its choice opens there). */
  ownsRightClick(x: number, y: number): boolean {
    // The note's rows are under its header image, as a click finds them.
    const h = this.hitAt(x, y - (this.drawn?.heroRows ?? 0));
    return !!h && "link" in h && (h.link.role === "task" || h.link.role === "callout");
  }

  /**
   * A right-click at the surface's cell `x`, `y` on a button: element.select makes it the `[ ]` position and nothing runs,
   * so the tile menu that opens there is about it (its "pin to status bar", PIE-1415). Null anywhere else.
   */
  pointAt(x: number, y: number, host: SurfaceHost): Promise<unknown> | null {
    const h = this.hitAt(x, y - (this.drawn?.heroRows ?? 0)), i = h && "link" in h && h.link.press && h.elem ? this.elems.findIndex(el => el.key === h.elem) : -1;
    return i < 0 ? null : this.runKey("element.select", { n: i + 1 }, host);
  }

  /** What the last render put at the surface's cell `x`, `y` (a link, a copy control, a panel row, a choice…). */
  private hitAt(x: number, y: number): Hit | undefined {
    const at = this.hits.filter(h => h.row === y && x >= h.from && x < h.to);
    return at.find(h => "block" in h) ?? at.find(h => "copy" in h || "link" in h || "thread" in h || "history" in h || "pick" in h || "image" in h || "crumbs" in h || "start" in h || ("follow" in h && h.follow)) ?? at[0];
  }

  // ── keys: each one is an action, the same ones an agent calls ─────────────

  key(k: Key, host: SurfaceHost): boolean {
    this.use(host);
    // A step's status choice, the property panel, the edit or the comment: the first open one takes the key.
    if (k.kind === "esc" && !this.modes.top()) {
      const attachment = this.modes.all().find(m => m.name === "sources" || m.name === "comment" || m.name === "replies");
      if (attachment) return attachment.key(k, host);
    }
    const taken = this.modes.key(k, host);
    if (taken !== null) return taken;
    // Back and forward (PIE-453): where the reader was before a follow, scrolled and with its [ ] position.
    const dir = historyKey(k);
    if (dir) { void this.runKey(dir < 0 ? "back" : "forward", {}, host); return true; }
    if (isTrailKey(k)) { void this.runKey("trail", {}, host); return true; }
    if (ch(k) === "~") { void this.runKey("decor.raw", {}, host); return true; }
    const c = ch(k);
    // An extension's line that is the current element (PIE-512): a key its actions answer to runs that
    // action (`w` wards); the reader's own keys stay the reader's (READER_OWN_KEYS).
    const xe = c ? this.inView()?.link?.ext : undefined;
    const xa = xe ? handlerKeyAction(xe.extension, xe.handler, c, host.ownKeys) : undefined;
    if (xe && xa) { void this.pressExt(xa.name, xe, host); return true; }
    // Selecting text (PIE-419): v starts the keyboard mode, y Y and cmd+c copy, esc lets go; the rest read on.
    if ((c === "v" || c === "y" || c === "Y" || isCopyKey(k) || this.selection) && this.msg && this.selectKey(k, host)) return true;
    if (host.attachment === "list-preview" && this.previewPoint()) {
      if (isUp(k) || isDown(k)) { void this.runKey("list.preview.scroll", { by: isDown(k) ? 1 : -1 }, host); return true; }
      if (ch(k) === "e") { void this.runKey("list.preview.edit", {}, host); return true; }
    }
    // e ctrl+e C m i I start a session: the note's action for that key (SESSION_ACTIONS), as the desk and the river run it.
    if (c === '"' && this.msg) { void this.runKey("note.quote", {}, host); return true; }
    const starts = this.msg ? sessionStart(k) : null;
    if (starts) {
      // e and ctrl+e arm the edit first (edit.arm): ⏎ or the key again opens it.
      if (armsEdit(starts)) { void this.runKey("edit.arm", starts === "external" ? { external: true } : {}, host); return true; }
      // The edit and the comment say their own refusals (a flash, the draft's note); the panel's are said here.
      void this.startAsPerson(starts, host).catch(e => { if (starts === "props" || starts === "props-full") host.ctx.flash(e instanceof Error ? e.message : String(e), undefined, errorDetails(e)); host.redraw(); });
      return true;
    }
    // c collapses where a pane can (the board's readers and lanes, which take it first); comment is C.
    if (c === "c") { host.ctx.flash("nothing collapses here · C comments on a passage"); return true; }
    // A: apply anyway (PIE-501), on the proposal shown, or the one whose embed or control is the current element.
    if (c === "r" && this.msg && this.proposalOperations(this.currentProposal() ?? this.msg.id).includes("resolve")) { void this.proposalControl("resolve", undefined, host); return true; }
    if (c === "A" && this.msg && (isOpenProposal(this.msg) || this.currentProposal())) { void this.proposalControl("apply", undefined, host); return true; }
    // X: dismiss it (the proposal shown, or the one whose embed or control is the current element).
    if (c === "X" && this.msg && (isOpenProposal(this.msg) || this.currentProposal())) { void this.proposalControl("dismiss", undefined, host); return true; }
    // The current element (`[ ]`, `( )`, a click) is let go by esc and by moving on (scrolling, following,
    // u), so ⏎ has its usual meaning again (in the board's preview: open the note in a detail). Then esc
    // lets go of a focus mark someone set here.
    if (k.kind === "esc" && (this.cur || this.link >= 0)) { void this.runKey("element.select", { n: 0 }, host); return true; }
    if (k.kind === "esc" && this.focusMark) { void this.runKey("block.untint", {}, host); return true; }
    // W zooms into the part the [ ] position or the reading line is in; esc then returns to the whole note (PIE-780).
    const zk = modeBinding(ZOOM_KEYS, k);
    if (zk && (zk.args?.on !== false || this.zoom) && this.msg && !this.msg.partial && isOutlineNote(this.msg)) { void this.runKey("element.zoom", zk.args ?? {}, host); return true; }
    if (isUp(k) || isDown(k)) { void this.runKey("reading.step", { by: isUp(k) ? -1 : 1 }, host); return true; }
    // A step that's the current element in view (PIE-472): space toggles it done or to do, as Detail's does;
    // ctrl+z undoes the last step change made here.
    if (c === " ") { const e = this.inView(); if (e?.kind === "task" && e.task) { void this.runKey("task.status", { to: stepClosed(e.task.step.status) ? "todo" : "done" }, host, true); return true; } }
    // ctrl+z undoes the last change made here, a step's status, a callout's header or an image's layout, whichever came last.
    if (k.kind === "char" && k.ctrl && k.ch === "z") {
      const at = this.msg?.id ?? "";
      // Right after esc dropped an edit's stray characters (src/stray.ts): they come back first.
      if (at && hasStrays(`edit:${at}`)) { void this.runKey("edit.strays", {}, host); return true; }
      const last = ([["callout.undo", this.calloutHistory.last("you", at)], ["image.undo", this.imageHistory.last("you", at)], ["use.undo", this.useHistory.last("you", at)], ["sources.undo", this.sourceHistory.last("you", at)], ["task.undo", this.stepHistory.last("you", at)], ["ext.undo", EXT_UNDO.last("you", at)], ["note.move.undo", MOVE_UNDO.last("you", at)]] as const)
        .reduce<{ name: "callout.undo" | "image.undo" | "use.undo" | "sources.undo" | "task.undo" | "ext.undo" | "note.move.undo"; seq: number }>((a, [name, e]) => e && (e.seq ?? 0) > a.seq ? { name, seq: e.seq ?? 0 } : a, { name: "task.undo", seq: -1 });
      // A note trashed after it comes back first (note.untrash). The layout isn't compared (PIE-1435): a tile moved elsewhere
      // didn't happen to this note, so the desk's ctrl+z (layout.undo, or a trash newer than it) gets the key only when the
      // reader has nothing of its own; with no layout change either, the reader's refusal says there's nothing to undo.
      const trashedAt = lastTrashed(host.ctx.board, USER)?.seq;
      if (trashedAt !== undefined && trashedAt > last.seq) {
        return last.seq >= 0 && !!host.untrash?.(host.ctx.board);
      }
      if (last.seq < 0 && host.layoutUndoSeq?.() !== undefined) return false;
      void this.runKey(last.name, {}, host, true);
      return true;
    }
    if (k.kind === "pgdn" || c === " " || k.kind === "pgup") { void this.runKey("scroll", { by: k.kind === "pgup" ? -15 : 15 }, host); return true; }
    // Home to the top; End or G to the last line, then (pressed again) past it to the middle (PIE-622).
    if (k.kind === "home" || k.kind === "end" || c === "G") { void this.runKey("scroll", { to: k.kind === "home" ? "top" : "end" }, host); return true; }
    // A live figure's element is current: its tabs, its density (figureKey).
    const fk = this.figureKey(k);
    if (fk) { void this.runKey(fk.name, fk.args as never, host); return true; }
    // An image is current (PIE-532): its size, where it sits, the header (imageKey).
    const ik = this.imageKey(k);
    if (ik) { void this.runKey(ik.name, ik.args as never, host); return true; }
    // [ ] walk every element in reading order (PIE-441); ( ) below stays the folds-only jump.
    if (c === "]" || c === "[") { void this.runKey("element.select", { by: c === "]" ? 1 : -1 }, host); return true; }
    if (c === "z") { void this.runKey("callouts", {}, host); return true; }
    // R: the note as written, without what the rules draw on it (PIE-600), and back.
    if (c === "R" && this.msg && isOutlineNote(this.msg)) { void this.runKey("note.reply", {}, host); return true; }
    // ,: a configurable note's settings card (PIE-786), as an app's settings are; elsewhere , isn't the reader's.
    if (c === "," && this.msg && !this.msg.partial && isOutlineNote(this.msg) && this.settingsSchemaOf(this.msg)) { void this.runKey("settings", {}, host); return true; }
    // ⏎ acts on the current element while the person can see it: a link follows (where is the host's call),
    // a fold toggles, a row or an embed opens its note, a comment mark its thread. alt+⏎ opens a link, a
    // row or an embed in a new reader. Otherwise ⏎ isn't the reader's.
    if (k.kind === "enter" || k.kind === "alt-enter") {
      const fresh = k.kind === "alt-enter", e = this.inView();
      if (!fresh && this.selectedFold()) { void this.runKey("fold.toggle", {}, host); return true; }
      if (e) {
        if (fresh && !opens(e) && !e.link?.press?.alt) return false;
        void this.runKey(e.link?.press ? "button.press" : "element.open", e.link?.press ? { n: this.elems.indexOf(e) + 1, ...(fresh ? { alt: true } : {}) } : fresh ? { fresh } : {}, host);
        return true;
      }
      if (!this.cur && this.links[this.link]) { void this.runKey("link.follow", fresh ? { fresh } : {}, host); return true; }
      return false;
    }
    if ((c === "(" || c === ")") && this.msg && !this.msg.partial) { void this.runKey("fold.select", { by: c === ")" ? 1 : -1 }, host); return true; }
    if (c === "f" && this.msg && !this.msg.partial) { void this.runKey("fold.toggle", {}, host); return true; }
    if (c === "F" && this.msg && !this.msg.partial) { void this.runKey(this.folded.size === 0 ? "fold" : "unfold", { all: true }, host); return true; }
    if (c === "u" && this.msg?.parentId) { void this.runKey("up", {}, host, true); return true; }
    const move = modeBinding(READER_MOVE_KEYS, k);
    if (move && this.msg && !this.msg.partial && isOutlineNote(this.msg)) { void this.runKey("note.move", move.args ?? {}, host); return true; }
    // alt+z: route this note by the outline's routing rules (PIE-1010); alt+Z says what would move, moving nothing.
    if (k.kind === "alt" && (k.ch === "z" || k.ch === "Z") && this.msg && !this.msg.partial && isOutlineNote(this.msg)) { void this.runKey("note.route", k.ch === "Z" ? { dry: true } : {}, host); return true; }
    // alt+D detaches the part the reader is on into a tile of its own (PIE-1247): the desk's element.detach, which places the tile.
    if (k.kind === "alt" && k.ch === "D" && this.msg && !this.msg.partial && isOutlineNote(this.msg) && host.detach) { host.detach(); return true; }
    // b: this note's links (Outlinks, Resources, Backlinks) in the screen's links tile.
    if (c === "b" && this.msg && !this.msg.partial) { void this.runKey("links", {}, host, true); return true; }
    // The margin's cards (ADR 0004 contract 6): a row each, whole, or off.
    if (c === "M" && this.msg && !this.msg.partial) { void this.runKey("margin", {}, host); return true; }
    // r: fetch the tickets this note shows now (PIE-445): the one the [ ] position is on, else the note's.
    if (c === "r" && this.msg && isOutlineNote(this.msg)) { void this.runKey("projection.refresh", {}, host, true); return true; }
    // S: where this note's generated regions come from (PIE-956 S6b): the Sources inspector.
    if (c === "S" && this.msg && !this.msg.partial && isOutlineNote(this.msg)) { void this.runKey("sources.open", {}, host); return true; }
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
    }, [
      { set: NOTE_ACTIONS, takes: "tile", noun: "a reader", on: (_, how) => ({ surface: this, host, standing: how.standing }), run: (name, args, on, actor, typed) => this.run(name, args, host, actor, on.standing, typed) },
      { set: LISTVIEW_ACTIONS, takes: "tile", noun: "a list", on: (_, how) => ({ host: this.listHost(host), standing: how.standing }) },
    ]);
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
    if (action === RUN_AGAIN) return this.act("projection.refresh", { block: x.block, line: x.line }, host, actor);
    if (!EXT_ACTIONS.has(action)) { host.ctx.flash(`${action} isn't here any more: its extension was removed or reloaded`); return Promise.resolve(null); }
    return EXT_ACTIONS.run(action, { block: x.block, line: x.line }, { ctx: host.ctx as Ctx }, actor);
  }

  /**
   * A press (PIE-957, a `::button` or a view's button, badge, card or row): its action line through the door's one dispatcher,
   * as `actor`. The head is an action the door has, or a script's name (it runs as the script, with the note the press is in
   * as `this`); the words are its arguments. The person's press runs at once (their click is the consent; what it does is
   * attributed and undoable: ext.undo, layout.undo). An agent's is attributed and said, as any `act` is.
   */
  async runPress(p: NonNullable<Link["press"]>, host: SurfaceHost, actor: Actor, repick = false): Promise<unknown> {
    const d = (host.ctx as { dispatch?: import("./dispatch").Dispatcher }).dispatch;
    if (!d) throw new ActionRefused("this screen has no dispatcher to run a press");
    const run = async () => {
      const note = p.block ? await host.ctx.board.get(p.block) : null;
      const button = note ? buttonCallAt(note.text.split("\n"), p.line) : null;
      // A button that reads differently than it was written runs nothing (it never acts on the focused tile instead); one with an
      // empty slot asks for it, and alt+click on a button with slots (and no alt= of its own) asks again (PIE-1298).
      if (button?.problem && button.act === null) throw new ActionRefused(`the ::button on line ${button.line + 1} runs nothing: ${button.problem}`);
      if (button && note && (button.empty.length || (repick && button.slots.length))) return this.askSlots(note.id, button, repick ? button.slots.map(s => s.key) : button.empty, host, actor, !repick);
      if (button?.sequence && p.act === button.act) {
        // Its first step refused now (no tile it names, PIE-1418): said before anything runs, in the presser's words.
        const first = sequenceStart(button), no = first ? d.refusedNow(actRequestOf(lineWords(first)), actor) : null;
        if (no) throw new ActionRefused(`${button.label} can't run here: ${no}`);
        const invitation = actor.kind === "user" ? INVITES.mint("you") : undefined;
        const r = await host.ctx.board.request<import("../extensions").ExtensionActResult>("scripts.sequence", {
          blockId: note!.id, line: p.line, clientId: host.ctx.board.clientId, invitation, mutation: mutationFor(actor),
        });
        if (invitation && r.undo) INVITES.bind(invitation, r.undo);
        if (r.undo) EXT_UNDO.push({ undo: r.undo, label: button.label, by: partyOf(actor), context: note!.id });
        host.redraw();
        // The step that stopped it, in its own words, to an agent (PIE-1264); the person hears it from `scripts.ended`.
        if (r.state === "failed" && actor.kind !== "user") throw new ActionRefused(r.message ?? `${button.label} failed`);
        return r;
      }
      let req;
      try { req = actRequestOf(lineWords(p.act)); } catch (e) { throw new ActionRefused(`${p.act}: ${e instanceof Error ? e.message : String(e)}`); }
      if (req.as !== undefined) throw new ActionRefused(`${p.act}: a press runs as ${actor.kind === "user" ? "you" : "its presser"}; leave out as=`);
      const args: Record<string, unknown> = { ...(req.args ?? {}) };
      let action = req.action;
      if (!d.takes(d.requestIn(req, messageContext.getStore()?.tile))) {
        const { listed, scripts } = await this.scriptsNamed(action, p.block || this.msg?.id, p.line, host);
        if (!scripts.length) {
          throw new ActionRefused(installWords(action, listed.available) ?? d.unknownAction(action));
        }
        if (scripts[0]!.state === "failed") throw new ActionRefused(scripts[0]!.error!);
        if (scripts.length > 1) host.ctx.flash(scripts[0]!.description ?? "");
        action = scripts[0]!.actions.find(a => a.id === "run")!.name;
      }
      // An extension's action acts on a note: the one this press is written in, unless the line names another.
      if (EXT_ACTIONS.has(action) && args.block === undefined) args.block = p.block || this.msg?.id;
      // The person's press of a script is invited by the script's action itself (extensions.ts, lineAction). Any press names
      // its button (via), so the run's note records it and the run reads its slots whole (`page=a page=b`).
      if (scriptActions().some(s => s.action.name === action)) {
        const home = p.block || this.msg?.id;
        if (home) args.via ??= `${home}:${p.line}`;
      }
      const result: unknown = await d.act(d.requestIn({ action, args, ...(req.tile !== undefined ? { tile: req.tile } : {}) }, messageContext.getStore()?.tile), actor);
      host.redraw();
      return result;
    };
    const home = p.block || this.msg?.id;
    const shown = () => home && p.line >= 0 ? pressing(home, p.line, () => host.redraw(), run, p.label) : run();
    return actor.kind === "user" ? d.pressDoing(p.act, { note: home }, shown) : shown();
  }

  /** The scripts called `name` as a press at `block`'s line `line` finds them (the note's own and its ancestors' first). */
  private async scriptsNamed(name: string, block: string | undefined, line: number | undefined, host: SurfaceHost) {
    const listed = await host.ctx.board.listExtensions(false, { blockId: block, ...(line !== undefined ? { line } : {}) });
    return { listed, scripts: listed.extensions.filter(e => e.script && e.name === name && (e.state === "active" || e.state === "failed")) };
  }

  /**
   * What slot `key` of `button` is asked as (PIE-1298): the question of the argument that reads it, from that argument's own
   * declaration: an action's arg schema, or for a script step the slot the script declares (`[form-field::page note]`), read
   * from the script the press would run. Null when nothing declares it (it is asked as text).
   */
  private async slotQuestion(block: string, button: ButtonCall, key: string, host: SurfaceHost) {
    const use = slotArgs(button, key)[0];
    if (!use) return null;
    let action = use.action;
    if (use.script) {
      const run = (await this.scriptsNamed(action, block, button.line, host)).scripts[0]?.actions.find(a => a.id === "run");
      if (!run) return null;
      action = run.name;
    }
    return argQuestion(host.ctx as never, action, use.arg);
  }

  /**
   * A press of a button with an empty slot (PIE-1298): the person is asked for it in the kind the action's own argument takes
   * (the wire picker for a tile: click one, h j k l, 1-9; the power bar's kind completion for a note, a screen, a file), and
   * the choice is written on the line (`button.slot`, the note's checked save, ctrl+z takes it back). A later press runs bound.
   * An agent is never asked: it is told the line to run, and the picker stays the person's. With `run` (a press, not a
   * re-pick), the last answer presses the button: the person pressed it to run it (PIE-1392).
   */
  async askSlots(block: string, button: ButtonCall, keys: readonly string[], host: SurfaceHost, actor: Actor, run = false): Promise<unknown> {
    const key = keys[0]!, line = button.line + 1;
    const d = (host.ctx as { dispatch?: import("./dispatch").Dispatcher }).dispatch;
    if (!d) throw new ActionRefused("this screen has no dispatcher to ask with");
    const q = await this.slotQuestion(block, button, key, host);
    if (actor.kind !== "user") {
      throw new ActionRefused(`${button.label} has no ${key} yet: it is the person's to choose; give it: button.slot note=${block} line=${line} key=${key} value=<${q?.kind ?? "the value"}>${q?.kind === "tile" ? " (a tile's name, its id or drawer.agent)" : ""}`);
    }
    const tile = messageContext.getStore()?.tile;
    // The keys still to ask go with the answer (a re-pick asks filled slots too, so they can't be read again from `empty`).
    const later = keys.slice(1), rest = `${later.length ? ` next=${later.join(",")}` : ""}${run ? " run=true" : ""}`;
    const then = `button.slot note=${block} line=${line} key=${key}${rest}${tile ? ` --tile ${tile}` : ""}`;
    const what = keys.length > 1 ? `${key} (${button.slots.findIndex(s => s.key === key) + 1} of ${button.slots.length})` : key;
    if (q?.kind === "tile") {
      host.ctx.flash(`${button.label}: choose a tile for ${key}`);
      return d.act({ action: "tile.pick", args: { then, prompt: `${button.label}: choose a tile for ${what}` }, ...(tile ? { tile } : {}) }, actor);
    }
    return askInBar(host.ctx as never, `${button.label}: ${what}`, [q ?? { name: "value", type: "text", label: key, free: true, required: true }], {}, actor,
      answers => d.act({ action: "button.slot", args: { note: block, line, key, value: answers.value ?? "", ...(later.length ? { next: later.join(",") } : {}), ...(run ? { run: true } : {}) }, ...(tile ? { tile } : {}) }, actor));
  }

  /**
   * `button.slot` (PIE-1298): write one slot of a `::button` onto its line, through the note's checked save, recorded as whoever
   * asks; ctrl+z (sources.undo) takes it back. A tile is written as an address that stays true: the id of the tile (`t-<uuid>`) or
   * the place it fills (`drawer.agent`, `role:<role>`, `<slot>@<screen>`), never the number a layout gives it (`t7`, `3`, `#3`). With no value
   * the person is asked again (a re-pick); with `ask`, the next empty slot is asked after it.
   */
  async setButtonSlot(a: { note?: string; line?: number; label?: string; key?: string; value?: string; ask?: boolean; next?: string; run?: boolean }, host: SurfaceHost, actor: Actor): Promise<unknown> {
    const m = a.note && a.note !== this.msg?.id ? await host.ctx.board.get(a.note) : await this.whole();
    if (!m) throw new ActionRefused(`no note ${a.note}: button.slot note=<id> takes the note the button is written in`);
    const buttons = buttonCallsOf(m.text);
    const hits = a.line !== undefined ? buttons.filter(b => b.line === a.line! - 1) : a.label !== undefined ? buttons.filter(b => b.label === a.label || b.label.toLowerCase().includes(a.label!.toLowerCase())) : buttons.filter(b => b.slots.length);
    const names = buttons.filter(b => b.slots.length).map(b => `line ${b.line + 1} "${b.label}" (${b.slots.map(s => s.key).join(", ")})`).join("; ");
    if (!hits.length) throw new ActionRefused(`no ${a.line !== undefined ? `button on line ${a.line}` : a.label !== undefined ? `button called "${a.label}"` : "button with a slot"} in this note; ${names ? `buttons with slots: ${names}` : "none has a slot (a button with act=\"… tile={target}\" target= has one)"}`);
    if (hits.length > 1) throw new ActionRefused(`${hits.length} buttons match (${names}); say line=<n>`);
    const button = hits[0]!;
    const key = a.key ?? (button.empty[0] ?? (button.slots.length === 1 ? button.slots[0]!.key : undefined));
    if (!key || !button.slots.some(s => s.key === key)) throw new ActionRefused(`${button.label} has ${button.slots.length ? `the slots ${button.slots.map(s => s.key).join(", ")}; say key=<one>` : "no slot"} (write target= on its line and {target} where it goes)`);
    if (a.value === undefined) return this.askSlots(m.id, button, [key], host, actor, !!a.run);
    const given = await this.slotValue(m.id, button, key, a.value, host, actor);
    const line = button.line, before = m.text.split("\n")[line] ?? "", after = withButtonSlot(before, key, given);
    if (after === null) throw new ActionRefused(`that value can't be written on line ${line + 1}: a button line can't hold a newline, { or } in a value`);
    const wrote = after !== before;
    const r = await this.inTurn(() => this.rewriteLines(m.id, wrote ? [{ line, before, after }] : [], this.sourceHistory, host, actor, SOURCE_STALE));
    const said = `${button.label}: ${key}=${given}`;
    if (wrote) { host.ctx.flash(`${said}${actor.kind === "user" && !a.run ? " · press it again to use it · ctrl+z takes it back" : ""}`); this.noteAgent(actor, said); }
    host.redraw();
    const out = { block: m.id, line: line + 1, wrote: { [key]: given }, changed: wrote, revision: r.revision ?? null, recordedAs: mutationFor(actor) };
    // More slots empty on the same press: the next is asked (the person's pick leaves the rest to this).
    if (actor.kind === "user" && (a.next !== undefined || a.ask || a.run)) {
      const now = await host.ctx.board.get(m.id), again = now ? buttonCallAt(now.text.split("\n"), line) : null;
      const left = a.next !== undefined ? a.next.split(",").filter(Boolean) : a.ask ? again?.empty ?? [] : [];
      const fail = (e: unknown) => host.ctx.flash(e instanceof Error ? e.message : String(e));
      if (again && left.length) void this.askSlots(m.id, again, left, host, actor, !!a.run).catch(fail);
      // The last answer of a press runs it, as the press meant (PIE-1392); a slot still empty is asked by that press.
      else if (again && a.run && again.act !== null && !again.empty.includes(key)) void this.runPress({ act: again.act, block: m.id, line, label: again.label }, host, actor).catch(fail);
    }
    return out;
  }

  /**
   * A slot's value as it is kept (PIE-1298): a tile is kept by an address the tile grammar reads as identity (its `t-<uuid>`, a
   * role, a slot of a screen); a name, a number, `t7` or `focused` is resolved now and kept as the tile's id, for none of those
   * names the same tile after a layout changes. A value that names no tile is refused with the resolver's reason.
   */
  private async slotValue(block: string, button: ButtonCall, key: string, value: string, host: SurfaceHost, actor: Actor): Promise<string> {
    if (!value) return value;
    const q = await this.slotQuestion(block, button, key, host);
    if (q?.kind !== "tile") return value;
    const found = await tileNamed(host, value, actor);
    if ("why" in found) throw new ActionRefused(`not kept: ${found.why}`);
    return parseTileAddress(value).kind === "name" ? found.id : value;
  }


  /**
   * The block `r` refreshes: a ticket region's page (or ticket block) under the [ ] position, else this note's one
   * line that runs. With no position and several lines that run (a handler line, a component, an @name request), `r`
   * runs none of them and says which there are: a stray key never asks an agent again or runs a script (PIE-956).
   */
  refreshTarget(): { block: string; line?: number } {
    const x = this.inView()?.link?.ext;
    if (x) return { block: x.block, line: x.line };
    const l = this.inView()?.link;
    if (l?.refresh) return { block: l.refresh, ...(l.refreshLine !== undefined ? { line: l.refreshLine } : {}) };
    if (l?.role === "resource" && l.block) return { block: l.block };
    const m = this.msg!;
    // Not read yet: what the note runs isn't known, so nothing is asked of the service on a guess.
    if (!projectionsLoaded(m, this.src) && mayHaveProjections(m.text)) throw new ActionRefused("reading what this note runs · press again in a moment, or put [ ] on a line first");
    const runs = projectionsOf(m, this.src).filter(p => p.kind && p.kind !== "data");
    if (runs.length === 1) return { block: m.id, line: runs[0]!.anchor.line };
    if (runs.length > 1) throw new ActionRefused(`${this.runsWords(runs)} here: nothing ran · press ${RUN_AGAIN_KEY} with [ ] on one, or click its ${REGION_MARK} mark and its run again`);
    return { block: m.id };
  }
  /** The lines that run, in the words a refusal names them by: `3 lines run (kids, kids, @tidy)`. */
  private runsWords(runs: readonly ResourceProjection[]): string {
    const names = runs.map(p => (p.kind === "agent" ? String(p.key ?? p.propertyKey ?? "@ask") : p.label ?? p.propertyKey ?? p.provider));
    return `${runs.length} lines run (${names.slice(0, 4).join(", ")}${names.length > 4 ? ", …" : ""})`;
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
      host.ctx.flash(`not fetched: ${(e as Error).message}`, undefined, errorDetails(e));
      host.redraw();
      throw e;
    }
  }

  /**
   * The wheel, whatever the surface is doing: the note scrolls (under an inline property panel too), a
   * full panel moves its selection, a draft or a comment being written scrolls its view (the cursor stays),
   * and a comment session scrolls its thread list.
   */
  wheel(dir: 1 | -1, host: SurfaceHost, at?: { x: number; y: number }) {
    const r = this.listPreview.rect;
    if (at && r && this.previewPoint() && (host.attachment === "list-preview" || !host.hasWiredPreview?.()) && at.x >= r.col && at.x < r.col + r.cols && at.y >= r.row && at.y < r.row + r.rows) {
      void this.runKey("list.preview.scroll", { by: wheelRows(dir) }, host); return;
    }
    // A mode first (a draft's view or its preview, a comment's box or thread list, the full panel's rows), else the note scrolls.
    const float = at && this.floatAt(at.x, at.y, host);
    if (float === "draft") { void this.runKey("draft.scroll", { by: wheelRows(dir), preview: true }, host); host.redraw(); return; }
    if (float) { this.modes.get(float)?.wheel?.(dir, host, at); host.redraw(); return; }
    if (this.modes.wheel(dir, host, at)) { host.redraw(); return; }
    const d = this.drawn;
    if (at && d) {
      const row = at.y - d.heroRows + d.scroll;
      for (const [key, list] of this.inlineLists) {
        const elements = this.elems.filter(e => e.link?.inlineList?.key === key);
        const e = elements[0];
        if (!e) continue;
        const left = e.from - list.rows[e.link!.inlineList!.row]!.from;
        const first = Math.min(...elements.map(e => e.ruler[0])) - list.before;
        const last = Math.max(...elements.map(e => e.ruler[1])) + list.after;
        if (row < first || row >= last || at.x < left || at.x >= left + list.width) continue;
        if (dir > 0 ? list.view.top < list.view.maxTop : list.view.top > 0) {
          void this.runKey("element.scroll", { n: this.elems.indexOf(e) + 1, by: wheelRows(dir) }, host); return;
        }
      }
    }
    void this.runKey("scroll", { by: wheelRows(dir) }, host);
  }

  /** The note scrolled `by` rows within its length (the wheel, j k, PgUp PgDn): the current element is let go, nothing else moves. */
  scrollBy(by: number, letGo = true) { if (letGo) this.letGo(); this.endWant = null; this.scroll = scrolled(this.scroll, by, this.maxScroll); }

  /** End, G and to=end (PIE-622): the last line to the bottom edge first; from there, past the end as far as it goes. */
  scrollEnd(letGo = true) {
    if (letGo) this.letGo();
    // Which stop, decided now; where it is, at the next render (a header row coming or going changes the room).
    this.endWant = this.scroll < this.endScroll ? "edge" : "last";
    this.scroll = this.endWant === "edge" ? this.endScroll : this.maxScroll;
  }


  /**
   * Reading keys only (j k, arrows, PgUp PgDn, space, Home End): scroll the note without starting or
   * touching an edit, a comment or the panel. Hosts use it for a reader holding a session the person
   * isn't in. True when the key was one of them.
   */
  scrollKey(k: Key, host: SurfaceHost): boolean {
    // A draft or a comment session renders in place of the note, and its view follows its own cursor:
    // there is no note to scroll, so the keys aren't claimed (and the agent's cursor isn't moved).
    const c = ch(k);
    const by = isUp(k) ? -1 : isDown(k) ? 1 : k.kind === "pgdn" || c === " " ? 15 : k.kind === "pgup" ? -15 : 0;
    const to = k.kind === "home" ? "top" : k.kind === "end" || c === "G" ? "end" : undefined;
    if (!by && !to) return false;
    if (!this.replyParent && (this.draft || this.session?.composer)) {
      void this.runKey("draft.scroll", { by: to === "top" ? -1e9 : to === "end" ? 1e9 : by }, host);
    } else if (this.scrolls()) void this.runKey("scroll", to ? { to } : { by }, host);
    else return false;
    return true;
  }

  // ── folds ──────────────────────────────────────────────────────────────────

  /** The note's readable source, the note line each of its lines comes from, and its fold points. */
  foldsIn(m: Msg): { text: string; lines: number[]; points: FoldPoint[]; literal: Set<number>; unterminated: number | null; anchors: (string | undefined)[] } {
    const r = this.zoomed(m, readableSource(m, this.src));
    const sig = m.text + "\0" + r.text + "\0" + r.anchors.join("\0");
    if (this.foldCache?.text !== sig) this.foldCache = { text: sig, points: foldPoints(r.text, r.anchors), lines: r.lines };
    const all = m.text.split("\n");
    for (const p of this.foldCache.points) if (p.list) {
      const first = p.list.line;
      if (propertyTokensInLine(all[(r.lines[first] ?? 0) - 1] ?? "").some(t => t.key === "children" && t.value === "preview")) p.list.preview = true;
    }
    return { text: r.text, lines: r.lines, points: this.foldCache.points, literal: r.literal, unterminated: r.unterminated, anchors: r.anchors };
  }

  /** The note's readable source, only the zoomed part's lines while the reader is zoomed (PIE-780); each keeps its note line. */
  private zoomed<R extends { text: string; lines: number[]; literal: Set<number>; unterminated: number | null; anchors: (string | undefined)[] }>(m: Msg, r: R): R {
    const z = this.zoom;
    if (!z || m.id !== this.msg?.id) return r;
    if (this.zoomedMemo?.r === r && this.zoomedMemo.z === z) return this.zoomedMemo.out as R;
    const keep = r.lines.flatMap((l, i) => (l >= z.start && l <= z.end ? [i] : []));
    if (!keep.length) return r;
    const body = r.text.split("\n"), at = new Map(keep.map((i, n) => [i, n]));
    const out = { ...r, text: keep.map(i => body[i] ?? "").join("\n"), lines: keep.map(i => r.lines[i]!), anchors: keep.map(i => r.anchors[i]), literal: new Set([...r.literal].flatMap(i => (at.has(i) ? [at.get(i)!] : []))), unterminated: r.unterminated !== null && at.has(r.unterminated) ? at.get(r.unterminated)! : null };
    this.zoomedMemo = { r, z, out };
    return out;
  }

  private previews(p: FoldPoint) { return !this.printed && !!p.list && (this.previewLists.get(p.list.key) ?? p.list.preview); }

  effectiveFolded(p: FoldPoint) { return this.folded.has(p.key) || this.previews(p) && !this.previewOpen.has(p.key); }

  private effectiveFolds(m: Msg) {
    const folded = new Set(this.folded);
    for (const p of this.foldsIn(m).points) if (this.previews(p) && !this.previewOpen.has(p.key)) folded.add(p.key);
    return folded;
  }

  previewPoint(): FoldPoint | null {
    if (!this.msg || this.msg.partial) return null;
    const points = this.visibleFolds(this.msg).filter(p => this.previews(p));
    const lines = this.foldsIn(this.msg).lines, line = this.readingSourceLine();
    return points.find(p => p.key === this.foldSel) ?? points.find(p => lines[p.line]! <= line && line <= lines[p.end - 1]!) ?? points[0] ?? null;
  }

  private selectListPoint() { this.listPreview.top = 0; }

  toggleListPreview(p: FoldPoint, on?: boolean) {
    if (!p.list) throw new ActionRefused("select a list item with children first");
    const show = on ?? !this.previews(p);
    this.previewLists.set(p.list.key, show);
    for (const q of this.foldsIn(this.msg!).points) if (q.list?.key === p.list.key) { this.previewOpen.delete(q.key); this.folded.delete(q.key); }
    return { preview: show };
  }

  /** The fold points drawn now: none inside a folded section or item. */
  visibleFolds(m: Msg): FoldPoint[] {
    const out: FoldPoint[] = [], folded = this.effectiveFolds(m);
    let hideTo = -1;
    for (const p of this.foldsIn(m).points) {
      if (p.line < hideTo) continue;
      out.push(p);
      if (folded.has(p.key)) hideTo = p.end;
    }
    return out;
  }

  /**
   * Fold (or unfold) `p`. By the person's keys or click it becomes the selected fold point, kept in view;
   * an agent's fold leaves their selection and scroll where they were.
   */
  setFold(p: FoldPoint, on: boolean, select = true) {
    if (this.previews(p)) { if (on) this.previewOpen.delete(p.key); else this.previewOpen.add(p.key); }
    if (on) this.folded.add(p.key); else this.folded.delete(p.key);
    if (select) { this.letGo(); this.foldSel = p.key; this.readingLine(this.foldsIn(this.msg!).lines[p.line] ?? 0); }
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
    if (!on) { const n = this.folded.size; this.folded.clear(); for (const p of this.msg ? this.foldsIn(this.msg).points : []) if (this.previews(p)) this.previewOpen.add(p.key); if (select) this.reveal = !!this.foldSel; return n; }
    this.previewOpen.clear();
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
    const rows = this.readingRows();
    // A river digest draws the whole note; its host owns scrolling, not this surface's viewport.
    const visible = this.digesting || !!rows && rows[1] > this.scroll && rows[0] < this.scroll + (this.drawn?.room ?? 0);
    const line = visible ? this.readingSourceLine() : this.position.view?.line ?? this.readingSourceLine();
    const lines = this.foldsIn(this.msg!).lines;
    const p = (d === 1 ? vis.find(p => (lines[p.line] ?? 0) >= line + (visible ? 1 : 0)) : vis.findLast(p => (lines[p.line] ?? 0) <= line - (visible ? 1 : 0))) ?? (d === 1 ? vis[0] : vis.at(-1));
    if (!p) return false;
    this.letGo();
    this.foldSel = p.key;
    this.readingLine(lines[p.line] ?? 0);
    this.revealReading();
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
    const top = this.foldsIn(m).lines.indexOf(this.readingRows() ? this.readingSourceLine() : this.position.view?.line ?? 0);
    const around = vis.filter(p => p.line <= top && top < Math.max(p.end, p.line + 1));
    return around.findLast(p => p.kind === "heading") ?? around.at(-1) ?? null;
  }

  /** The folds for `peek`: how many fold points, which are folded, and the one the keys selected. */
  private describeFolds(m: Msg) {
    const points = this.foldsIn(m).points, sel = points.find(p => p.key === this.foldSel);
    return { points: points.length, folded: points.filter(p => this.effectiveFolded(p)).map(foldLabel), selected: sel ? foldLabel(sel) : null };
  }

  /** The note line (from 0, the subject line) reader row `y` of the last render shows, or null off the note's body. */
  /**
   * What the reader has in view (PIE-413's view.get and view.subscribe): the note lines in its body rows, first
   * and last (1 is the subject), and the body's scroll: `atEnd` once its last row shows, `past` the blank rows
   * under it when it's scrolled past the end (PIE-622). Null before it's drawn. A scroll since the last render
   * (an action answering before the paint) is counted, so `scroll` answers where it went.
   */
  viewport(): { first: number | null; last: number | null; top: number; room: number; total: number; atEnd: boolean; past: number } | null {
    const d = this.drawn;
    if (!d) return null;
    const top = this.endWant ? (this.endWant === "edge" ? this.endScroll : this.maxScroll) : Math.max(0, Math.min(this.scroll, this.maxScroll));
    // The room at that scroll: a header image gives a row back for each row scrolled.
    const room = top === d.scroll ? d.room : d.roomAt(top);
    // The drawn rows' note lines are 0-based; a line here is 1-based, as block.tint and comments count them.
    const lineOf = (row: number) => { const b = d.doc.source[row]; const l = b === undefined ? undefined : d.lines[b]; return l === undefined ? null : l + 1; };
    const shown = Array.from({ length: Math.max(0, Math.min(room, d.body.length - top)) }, (_, i) => lineOf(top + i)).filter((x): x is number => x !== null);
    // At the end: the last row is in view. Past it (PIE-622): the rows scrolled on from End's first stop, blank under it.
    return { first: shown[0] ?? null, last: shown.at(-1) ?? null, top, room, total: d.body.length, atEnd: top + room >= d.body.length, past: Math.max(0, top - this.endScroll) };
  }

  /** Scroll so note line `line` (1 is the subject) is the first body row in view (view.scrollTo). False before it's drawn. */
  scrollToLine(line: number): boolean {
    const d = this.drawn;
    if (!d) return false;
    const row = d.doc.source.findIndex(b => b !== undefined && (d.lines[b] ?? 0) + 1 >= line);
    this.endWant = null;
    this.scroll = Math.max(0, Math.min(this.maxScroll, row < 0 ? d.body.length : row));
    return true;
  }

  anchorView() { if (!this.position.view) this.positionRows.top = this.scroll; }

  readingLine(line: number) {
    this.position.reading = (this.msg?.text ?? "").split("\n").slice(0, line).reduce((n, l) => n + l.length + 1, 0);
  }

  private readingSourceLine() { return lineAtOffset(this.msg?.text ?? "")(this.position.reading); }

  /** All wrapped rows of one source block, shared by navigation and ruler paint. */
  private blockRows(doc: Doc, row: number): [number, number] {
    const source = doc.source[row];
    let a = row, b = row + 1;
    while (a > 0 && doc.source[a - 1] === source) a--;
    while (b < doc.source.length && doc.source[b] === source) b++;
    return [a, b];
  }

  private readingRows(): [number, number] | null {
    const d = this.drawn;
    if (!d) return null;
    const line = this.readingSourceLine();
    const row = d.doc.source.findIndex(s => d.lines[s] === line);
    return row < 0 ? null : this.blockRows(d.doc, row);
  }

  private revealReading() {
    const rows = this.readingRows(), d = this.drawn;
    if (!rows || !d) return;
    if (rows[0] < this.scroll) this.scroll = rows[0];
    else if (rows[1] > this.scroll + d.room) this.scroll = Math.min(rows[0], rows[1] - d.room);
  }

  stepReading(by: 1 | -1) {
    const current = this.selectedElement();
    const figure = current?.link?.figure?.figure;
    const links = current?.link?.listRow?.key;
    if (figure || links) {
      const entries = this.elems.filter(e => figure ? e.kind === "row" && e.link?.figure?.figure === figure : e.link?.listRow?.key === links && e.link?.listRow?.row !== undefined);
      const entry = entries[0];
      const inline = current.link?.inlineList ?? entry?.link?.inlineList;
      if (inline && entry) {
        const list = this.inlineLists.get(inline.key)!;
        const row = current.link?.inlineList ? current.link.inlineList.row + by : by > 0 ? 0 : list.rows.length - 1;
        this.selectInlineRow(entry, Math.max(0, Math.min(list.rows.length - 1, row)));
      }
      return;
    }
    const inline = current?.link?.inlineList;
    if (inline) {
      const list = this.inlineLists.get(inline.key)!;
      const row = inline.row + by;
      if (row >= 0 && row < list.rows.length) { this.selectInlineRow(current!, row); return; }
    }
    this.letGo();
    const d = this.drawn;
    if (!d) return;
    const rows = this.readingRows();
    const visible = rows && rows[1] > this.scroll && rows[0] < this.scroll + d.room;
    if (visible && (by > 0 ? rows[1] > this.scroll + d.room : rows[0] < this.scroll)) {
      this.scroll = by > 0 ? Math.min(rows[1] - 1, this.scroll + d.room) : Math.max(rows[0], this.scroll - d.room);
      return;
    }
    const sourceLines = this.msg!.text.split("\n");
    let row = visible ? (by > 0 ? rows[1] : rows[0] - 1) : this.scroll;
    while (row >= 0 && row < d.doc.source.length) {
      const source = d.doc.source[row]!, line = d.lines[source];
      if (line !== undefined && sourceLines[line]?.trim()) {
        this.letGo(); this.foldSel = null;
        this.readingLine(line);
        const p = this.foldsIn(this.msg!).points.find(p => d.lines[p.line] === line && this.previews(p));
        if (p) { this.foldSel = p.key; this.selectListPoint(); }
        const candidates = this.elems.filter(e => e.link?.inlineList && d.lines[d.doc.source[e.row - d.top]!] === line);
        const entry = by > 0 ? candidates[0] : candidates.at(-1);
        if (entry) {
          const list = this.inlineLists.get(entry.link!.inlineList!.key)!;
          this.selectInlineRow(entry, by > 0 ? 0 : list.rows.length - 1);
        }
        this.revealReading();
        const block = this.readingRows();
        if (by < 0 && visible && block && block[1] - block[0] > d.room) this.scroll = Math.max(block[0], block[1] - d.room);
        return;
      }
      row += by;
    }
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
  private follow(i: number, host: SurfaceHost, fresh = false): Promise<Msg | Outside | TagList | null> {
    const l = this.links[i];
    return l ? this.followTarget(l, host, { link: true, fresh }) : Promise.resolve(null);
  }

  // ── elements: what [ ] walks, ⏎ acts on and the ruler tints (PIE-441) ─────

  /** The current element's figure's keys, for the hint: its tabs and its density. */
  private figureHint(): string {
    const f = this.currentFigure();
    return f ? ` · ↑ ↓ row · esc out${f.tabs ? " · ← → tab · ⇥ ⇤" : ""}${f.kind === "tabs" || f.kind === "table" ? ` · = ${nextDensity(f.density)}` : ""}` : "";
  }

  /** Nothing is current: the next `[ ]` starts from the view, and ⏎ is the host's again. */
  letGo() { this.cur = null; this.link = -1; this.linkUnlaid = null; }
  /** The generated regions the last layout drew (src/output-region.ts): what `[ ]` stops on at each one's gutter mark. */
  private regionInfo = new Map<string, { label: string; target: LinkTarget }>();
  /** Their rows in the reader's content rows (header included), for `openRegionKey`. */
  private regionSpans: { key: string; from: number; to: number }[] = [];
  /**
   * The region whose row behind its mark is shown: the one the `[ ]` position is in (its mark, a control in that row, a link
   * in its words). Hovering would do it too, but the door asks the terminal for button tracking, not motion.
   */
  private openRegionKey(): string | null {
    const e = this.cur ? this.elems.find(x => x.key === this.cur) : undefined;
    if (!e) return null;
    if (e.region) return e.region;
    return this.regionSpans.find(r => e.row >= r.from && e.row < r.to)?.key ?? null;
  }

  private setElem(e: Element) {
    const d = this.drawn;
    if (d) {
      this.anchorView();
      const line = e.previewLine ?? d.lines[d.doc.source[e.row - d.top]!];
      if (line !== undefined) this.readingLine(line);
    }
    this.foldSel = null;
    this.cur = e.key;
    const p = this.msg && this.foldsIn(this.msg).points.find(p => `fold:${p.key}` === e.key);
    if (p && this.previews(p)) this.selectListPoint();
    const l = e.link;
    this.link = l ? this.links.findIndex(x => sameLink(x, l)) : -1;
    // A row of an inline ::links (PIE-693): it's that component's selection too, and its preview follows.
    const lb = l?.listRow;
    if (lb?.row) { try { this.listViews.get(lb.key)?.pick(PERSON, lb.row); } catch { /* a row the list no longer draws */ } }
  }

  /** The current element while the person can see it (or it's about to be brought into view). */
  inView(): Element | null {
    const e = this.selectedElement(), d = this.drawn;
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
    const reading = this.readingRows();
    const visible = reading && reading[1] > v.scroll && reading[0] < v.scroll + v.room ? reading : null;
    let i = es.findIndex(e => e.key === this.cur);
    if (i >= 0) i = (i + d + n) % n;
    else if (d === 1) { const from = visible ? v.top + visible[0] : v.scroll ? v.top + v.scroll : 0; i = es.findIndex(e => e.row >= from); if (i < 0) i = 0; }
    else { const bottom = visible ? v.top + visible[1] : v.top + v.scroll + v.room; i = es.findLastIndex(e => e.row < bottom); if (i < 0) i = n - 1; }
    this.setElem(es[i]!);
    this.reveal = true;
    return true;
  }

  /**
   * ⏎ (or a click) on an element. The person's (`select`, the default) becomes their `[ ]` position; an
   * agent's leaves it where it was (a fold it toggles isn't selected, a thread list is its own session).
   */
  private async enterElement(e: Element, host: SurfaceHost, { fresh = false, select = true, actor = USER }: { fresh?: boolean; select?: boolean; actor?: Actor } = {}): Promise<unknown> {
    if (select) this.setElem(e);
    if (e.kind === "fold") {
      const p = this.msg ? this.foldsIn(this.msg).points.find(p => `fold:${p.key}` === e.key) : undefined;
      if (!p) return null;
      this.setFold(p, !this.effectiveFolds(this.msg!).has(p.key), select);
      host.redraw();
      return { folded: this.folded.has(p.key) };
    }
    // A comment mark expands its thread under the passage, or collapses it (PIE-420): the person's only.
    if (e.kind === "comment") return select ? this.runKey("thread.toggle", { thread: e.thread! }, host) : null;
    if (e.kind === "control" && e.link?.proposal?.op) return this.proposalControl(e.link.proposal.op, e.link.proposal.id, host);
    if (e.kind === "control" && e.link?.unsent) return this.runKey(`unsent.${e.link.unsent.op}`, { kind: e.link.unsent.kind }, host);
    // A live figure's tab shows it; its density control steps to the next density.
    // (element.open sends an agent's through figure.tab and figure.density itself, with their rules.)
    if (e.kind === "figure" && e.link?.figure) { this.pressFigure(e.link.figure, host); return null; }
    // An inline ::links component's ⏎ in (PIE-693): the person goes into its list; an agent reads and opens its rows instead.
    if (e.link?.listRow && !e.link.listRow.row) {
      if (!select) throw new ActionRefused("going into a list is the person's; an agent reads it with list.blocks and opens a row with list.open");
      return this.runList("list.enter", { list: e.link.listRow.key }, host);
    }
    if (e.link?.anchor) return this.runKey("fields.anchor", { key: e.link.anchor.key, n: e.link.anchor.n }, host);
    // A `::use` that needs a prop: the person is asked for it in the power bar (an agent gives it: use.fill with=).
    if (e.link?.use) { if (!select) throw new ActionRefused("a ::use's missing props are asked of the person; an agent gives them: use.fill block=" + e.link.use.block + " line=" + (e.link.use.line + 1) + " with='{\"name\":\"value\"}'"); return this.runKey("use.fill", { block: e.link.use.block, line: e.link.use.line + 1 }, host); }
    // A generated region's mark with nothing behind it to follow: `[ ]` on it already shows what there is.
    if (e.region && !e.link?.ext && !e.link?.block) { host.redraw(); return null; }
    if (e.kind === "control") return this.useControl(e, host);
    // A list row whose activation is text (PIE-747): ⏎ copies it, or puts it in the person's draft.
    if (e.link?.listText) return this.activateListText(e.link.listText, host, actor);
    // A code block or a quote has nothing to open: ⏎ copies it, as y does.
    if (e.kind === "block") return this.runKey("block.copy", { n: e.block! + 1 }, host);
    // A step's box opens its status choice under it (the person's; an agent sets a status by task.status).
    if (e.kind === "task") { if (select) this.openPicker(e); host.redraw(); return { step: e.task?.step.itemId ?? null, choice: select }; }
    // A callout's icon or type opens its type choice under it (the person's; an agent changes it by callout.type).
    if (e.kind === "callout") { if (select) this.openCalloutPicker(e); host.redraw(); return { callout: e.label, choice: select, types: calloutsOf(this.src).types.map(t => t.name) }; }
    const how: OpenHow = { link: true, fresh };
    const l = e.link!;
    if (e.value !== undefined) return this.followValue({ key: e.value, target: l.block ? { block: l.block } : { page: l.page! } }, host, how);
    return this.followTarget(l, host, how);
  }

  /** A list row's `copy` or `insert` (PIE-747): the person's copy goes to their clipboard (an agent's is returned to it); `insert` goes only into the person's own draft. */
  private activateListText(t: NonNullable<Link["listText"]>, host: SurfaceHost, actor: Actor): unknown {
    const person = actor.kind === "user";
    if ("copy" in t) {
      if (person && host.ctx.copy?.(t.copy) === false) throw new ActionRefused(`not copied: ${[...t.copy].length} chars is more than the clipboard takes`);
      host.ctx.flash(person ? `copied ${[...t.copy].length} char${[...t.copy].length === 1 ? "" : "s"}` : "copied for itself · your clipboard is untouched");
      return { copied: t.copy, clipboard: person };
    }
    // An insert is the person's own draft's (ADR 0004): an agent, invited or not, writes with outline_edit.
    if (!person) throw new ActionRefused("an agent writes with outline_edit, not into the person's draft");
    const s = this.draftSession();
    if (!s) { host.ctx.flash("no draft is open to put that in · e edits the note"); return { inserted: null }; }
    s.draft.pasteText(t.insert, USER);
    host.redraw();
    return { inserted: t.insert };
  }

  /** The thread list, on the current comment mark's thread, as the person's `m` opens it (their session). */
  private openThread(host: SurfaceHost) {
    if (host.startSession) host.startSession("threads");
    else void this.runKey("threads", {}, host, true);
  }

  // ── comment threads expanded inline (PIE-420) ─────────────────────────────

  /** Open or fold a card in this reader without moving its focus or selection. */
  setExpanded(thread: string, on: boolean) {
    this.keepCommentSelection();
    if (on) { this.expanded.add(thread); this.foldedThreads.delete(thread); }
    else { this.expanded.delete(thread); this.foldedThreads.add(thread); }
    if (this.marginMode === "off") {
      if (on) this.openedWhileOff.add(thread); else this.openedWhileOff.delete(thread);
    }
  }

  private commentSelection: { selection: Selection; text: string; from: number } | null = null;

  private keepCommentSelection() {
    const selection = this.selection, rows = this.selRows(true);
    const source = selection && this.sourceOf(selection, true);
    if (selection && rows && source && !this.commentSelection)
      this.commentSelection = { selection, text: selection.text(rows), from: source.from };
  }

  private restoreCommentSelection() {
    const saved = this.commentSelection;
    this.commentSelection = null;
    if (!saved || this.selection !== saved.selection) return;
    // The same source occurrence survives both inserted cards and a side column rewrapping the words.
    for (let n = 1; ; n++) {
      let next: Selection;
      try { next = this.selectBy({ text: saved.text, n, noteOnly: true }); } catch { return; }
      if (this.sourceOf(next, true)?.from !== saved.from) continue;
      if (saved.selection.anchor !== saved.selection.start) [next.anchor, next.head] = [next.head, next.anchor];
      next.keys = saved.selection.keys;
      this.selection = this.stamp(next);
      return;
    }
  }

  private openedWhileOff = new Set<string>();

  /** The margin's side column at reader width `w`: 0 when the cards fold under their passages (or there are none). */
  private marginCols(m: Msg, w: number): number {
    // Printed (`ep0ch show`), the threads are read with outline_threads: no cards in the drawing.
    return marginColumn(w, this.printed ? "off" : this.marginMode, this.cardThreads(m).length);
  }
  /** The threads drawn as cards. The margin's default (PIE-791): current threads only; seen and resolved are on the thread list's earlier shelf. */
  private cardThreads(m: Msg): Comment[] {
    return (this.commentsFor === m.id ? this.comments ?? [] : []).filter(c => (c.start !== null || isWholeNote(c)) && this.threadShown(c.id));
  }
  /** The thread the person just opened: the next frame brings its card into view. */
  private revealThread: string | null = null;
  private revealFrom: number | null = null;
  /** The person opened a card: it comes into view on the next frame (an agent's open leaves their view where it is). */
  revealCard(thread: string) { if (this.threadShown(thread)) { this.revealThread = thread; this.revealFrom = this.scroll; } }

  setMargin(mode: MarginMode) { this.keepCommentSelection(); this.marginMode = mode; this.openedWhileOff.clear(); }

  threadShown(thread: string): boolean {
    if (this.marginMode === "off") return this.openedWhileOff.has(thread);
    if (this.foldedThreads.has(thread)) return false;
    const c = this.comments?.find(c => c.id === thread);
    return this.expanded.has(thread) || !!c && c.open && hasCard(c);
  }

  /**
   * The person opened a thread (expanded it, or its card): it's read (PIE-708), so its replies leave Recent replies'
   * unread. Only the person's opening reads it; quietly, as a failure only leaves it unread.
   */
  readThread(thread: string, host: SurfaceHost) {
    if (this.expanded.has(thread)) void host.ctx.board.readThread(thread).catch(() => {});
  }

  /** A thread of the note shown, by id or its first 6+ characters. */
  threadId(named: string): string {
    const c = (this.comments ?? []).find(t => t.id === named || (named.length >= 6 && t.id.startsWith(named)));
    if (!c) throw new ActionRefused(`no comment thread ${named} on this note; peek lists them under comments.threads`);
    return c.id;
  }

  /** Each expanded thread's rows, spliced into the body under the last row of its passage, and its controls. */
  private threadCard(c: Comment, width: number, host?: SurfaceHost, drawn: Link[] = []) {
    return threadPanel(c, width, this.cur, (t, w) => this.snippetDoc(t, w, host, drawn, true),
      this.marginMode === "trim" && !this.expanded.has(c.id));
  }

  private threadPanels(m: Msg, doc: Doc, noteLines: number[], W: number, fold = false, composer?: readonly string[], host?: SurfaceHost, drawn: Link[] = []): { doc: Doc; controls: Control[]; cards: { at: number; rows: number; bg: string }[]; passage: [number, number] | null; composerAt: number | null } {
    // A narrow reader folds each annotation's card under its passage (ADR 0004 contract 6), unless the margin is off.
    // The passage of the comment being written (PIE-770): its rows, and its box under them (after its thread, if expanded).
    const span = this.session ? this.composerSpan(this.session, m) : null;
    const lineOf = lineAtOffset(m.text);
    const at = span ? rowsOfLines(doc, noteLines, lineOf(span[0]), lineOf(Math.max(span[0], span[1] - 1))) : null;
    // Not inline, the box's place is still where the passage and its open thread end: a floating box goes past both. A
    // comment on the whole note, or a reply to one, is at the top of the body, where whole-note threads are (PIE-846).
    const box = composer || span ? [{ at: at ? at[1] : this.writingOnWhole() ? 0 : doc.lines.length, lines: composer ?? [], controls: [] as Control[] }] : [];
    const placed = (d: Doc, starts: number[], n: number) => {
      const was = at && starts.length ? rowsOfLines(d, noteLines, lineOf(span![0]), lineOf(Math.max(span![0], span![1] - 1))) : at;
      return { passage: was, composerAt: box.length ? starts[n] ?? null : null };
    };
    if (!fold || this.printed) {
      if (!box.length) return { doc, controls: [], cards: [], passage: at, composerAt: null };
      const { doc: out, starts } = withRows(doc, box);
      return { doc: out, controls: [], cards: [], ...placed(out, starts, 0) };
    }
    const cs = this.comments ?? [];
    const panels = this.commentMarks(m, doc, noteLines).flatMap(k => {
      const c = cs.find(x => x.id === k.thread);
      if (!c || !fold || this.printed || !this.threadShown(c.id)) return [];
      return [{ at: k.rows[1], thread: c.id, ...this.threadCard(c, W, host, drawn) }];
    });
    if (!panels.length && !box.length) return { doc, controls: [], cards: [], passage: at, composerAt: null };
    // A reply's box goes right under its own thread; a comment's after every thread on its passage.
    const t = this.session?.mode === "compose" ? this.session.target : null;
    const own = t && (t.kind === "reply" || t.kind === "edit") ? panels.findIndex(p => p.thread === t.thread.id) : -1;
    const n = own >= 0 ? own + 1 : panels.length;
    const all = [...panels.slice(0, n), ...box, ...panels.slice(n)];
    const { doc: out, starts } = withRows(doc, all);
    const shown = (i: number) => (i < n || !box.length ? i : i + 1);
    return { doc: out, controls: panels.flatMap((p, i) => p.controls.map(c => ({ ...c, row: starts[shown(i)]! + c.row }))),
      cards: panels.map((p, i) => ({ at: starts[shown(i)]!, rows: p.lines.length, bg: p.bg })), ...placed(out, starts, n) };
  }

  /** The note's `{{ }}` as the service read them, for the property panel (the draft's, while one is open). */
  private valueRows(m: Msg, src: Source | null): ValueRow[] {
    if (!isOutlineNote(m)) return [];
    const text = this.draft?.text ?? m.text;
    const answer = siteAnswerOf(m.id, text, src, !!this.draft && this.draft.text !== m.text);
    return (answer?.values ?? []).slice(0, MAX_NOTE_VALUES).map(v => hasWords(v)
      ? { expression: v.expression, words: valueWords(v) || EMPTY_VALUE, ...(v.from ? { from: v.from } : {}) }
      : { expression: v.expression, words: "", problem: problemWords(v) });
  }

  /**
   * An expanded thread's control, by ⏎ or a click, through the comment code the thread list uses: Select
   * selects its passage (the reader's text selection, PIE-419); Reply opens the thread list as the person's
   * session with a reply to it started (Esc, or the reply landing, comes back here); Seen, Keep and TL;DR are
   * the thread list's s, p and t (PIE-791).
   */
  private async useControl(e: Element, host: SurfaceHost): Promise<unknown> {
    const c = this.comments?.find(x => x.id === e.thread);
    if (!c || !this.msg) return null;
    if (e.control === "toggle") return this.runKey("thread.toggle", { thread: c.id }, host);
    // A margin card folded under its passage: its thread expands there, as a click on its mark does.
    if (e.control === "card") {
      this.setExpanded(c.id, true);
      this.readThread(c.id, host);
      host.redraw();
      return { thread: c.id, expanded: true };
    }
    if (e.control === "select") {
      const sel = this.passageSelection(c);
      if (!sel) { host.ctx.flash("its passage isn't drawn here (the quoted words moved, or they're folded away)"); return { selected: null }; }
      this.selection = this.stamp(sel);
      host.redraw();
      return { selected: this.describeSelection(this.selection)?.text ?? null };
    }
    if (e.control === "reply") { this.replyOn = c.id; this.openThread(host); return { replying: c.id }; }
    if (e.control === "edit") { this.editOn = { thread: c.id, ...(e.value ? { reply: e.value } : {}) }; this.openThread(host); return { editing: e.value ?? c.id }; }
    // Quote: the thread's mark, or the reply the control is on; the power bar asks where it goes.
    if (e.control === "quote") return this.runKey("quote", { threads: e.value ?? c.id }, host);
    if (e.control === "quoted" && e.value) return this.followTarget({ block: e.value } as Link, host, { link: true, fresh: false });
    // No TL;DR (PIE-860): it goes, and the discussion is the thread's face again.
    if (e.control === "untldr") return this.runKey("thread.tldr", { thread: c.id, remove: true }, host);
    // Seen, Keep and TL;DR from the expanded thread: what the list's s, p and t do, without opening the list over the note.
    const s = new CommentSession(this.msg, this.comments ?? [], "threads");
    s.sel = s.threads.findIndex(t => t.id === c.id);
    if (e.control === "tldr") {
      const asked = await s.askTldr(this.commentEnv(host));
      if (s.error) host.ctx.flash(s.error);
      return { thread: c.id, asked };
    }
    if (e.control !== "seen" && e.control !== "keep") return null;
    const to = e.control === "seen" ? (c.open ? "seen" : "open") : c.lifecycle === "kept" ? "open" : "kept";
    await s.attend(this.commentEnv(host), to);
    if (s.error) host.ctx.flash(s.error);
    host.redraw();
    return { thread: c.id, lifecycle: to };
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
      // On the whole note (PIE-846): at the top of the body, its card on the first row.
      if (isWholeNote(c)) { out.push({ thread: c.id, open: c.open, row: 0, rows: [0, 0], label: `the whole note · ${kindOf(c) === "comment" ? "" : `${kindOf(c)} · `}${authorName(c.author)}${c.open ? "" : " · resolved"}` }); continue; }
      if (c.start === null || c.end === null) continue;
      const lo = lineOf(c.start), hi = lineOf(Math.max(c.start, c.end - 1));
      const rows = rowsOfLines(doc, noteLines, lo, hi);
      if (!rows) continue;
      const q = printable(c.quote).trim();
      out.push({ thread: c.id, open: c.open, row: rows[0], rows, label: `"${q}" · ${kindOf(c) === "comment" ? "" : `${kindOf(c)} · `}${authorName(c.author)}${c.open ? "" : " · resolved"}` });
    }
    const columns = new Map<number, number>();
    for (const mark of out) {
      const row = cs.some(c => c.id === mark.thread && isWholeNote(c)) ? -1 : mark.row;
      mark.col = columns.get(row) ?? 0;
      columns.set(row, mark.col + 3);
    }
    return out;
  }

  /** Everything `[ ]` can stop on in this render, in reading order (content rows, then columns). */
  private elementsOf(doc: Doc, drawn: Link[], marks: Mark[], controls: Control[], summary: { from: number; to: number; link: Link; key: string }[], points: readonly FoldPoint[], top: number, head: string[], summaryRow = 1, imageRef: ((i: number) => ImageRef | null) | null = null): Element[] {
    const out: Element[] = [];
    const seen = new Map<string, number>();
    const keyOf = (kind: string, l: Link) => {
      if (l.inlineList) return inlineRowKey(l.inlineList.key, l);
      const id = kind === "task" && l.task ? taskBase(l.task) : kind === "callout" && l.callout ? calloutBase(l.callout) : kind === "figure" && l.figure ? figureElemBase(l.figure) : l.proposal?.op ? `control:proposal:${l.proposal.op}:${l.proposal.id}` : `${kind}:${[l.block ?? "", l.fragment ?? "", l.label ?? "", l.page ?? "", l.media ?? "", l.url ?? ""].join("|")}`;
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      return `${id}#${n}`;
    };
    const block = (r: number): [number, number] => { const [a, b] = this.blockRows(doc, r); return [top + a, top + b]; };
    const text = (line: string, from: number, to: number) => cellsOf(line).slice(from, to).join("").trim();
    const sum = head[summaryRow] ?? "";
    for (const l of summary) out.push({ key: keyOf("link", l.link), kind: "link", row: summaryRow, from: l.from, to: l.to, ruler: [summaryRow, summaryRow + 1], label: `${l.key} ${text(sum, l.from, l.to)}`, link: l.link, value: l.key });
    for (const h of doc.heads) {
      const p = points.find(p => p.key === h.key);
      if (p && this.previews(p)) out.push({ key: `fold:${p.key}`, kind: "fold", fold: p.key, row: top + h.row, from: this.gutterStart, to: this.bx + h.cols, ruler: block(h.row), label: p.text });
    }
    const heads = new Set(doc.links.filter(r => drawn[r.n]?.role === "resource").map(r => r.line));
    const byN = new Map<number, typeof doc.links>();
    for (const r of doc.links) { const g = byN.get(r.n); if (g) g.push(r); else byN.set(r.n, [r]); }
    for (const [n, rs] of byN) {
      const l = drawn[n], r = rs[0]!;
      // An image's caption controls are click targets only: [ ] stops on the image, and its keys change it. A view's
      // picture's tag only says where it's placed: its caption is the stop.
      if (!l || l.role === "image" || l.role === "picture") continue;
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
      else if (kind === "control" && (l.ext || l.press)) ruler = [top + r.line, top + r.line + 1];
      const label = kind === "task" && l.task ? `${STEP_BOXES[l.task.step.status]} ${stepTitle(l.task.step)}${l.task.via ? ` · in ${l.task.via}` : ""}`
        : kind === "callout" && l.callout ? `[!${l.callout.type}] ${calloutTitle(l.callout)}`
        // A view's picture (PIE-827) is named by its file, as a note's image is.
        : l.query ?? (l.media && !l.role ? fileName(l.media) : rs.map(x => text(doc.lines[x.line]!, x.from, x.to)).join(" "));
      out.push({ key: keyOf(kind, l), kind, row: top + r.line, from: r.from + this.bx, to: r.to + this.bx, ruler, label, link: l, ...(ITEM_KINDS.has(kind) ? { item: [top + r.line, top + rs.at(-1)!.line + 1] as [number, number] } : {}), ...(l.task ? { task: l.task } : {}), ...(l.callout ? { callout: l.callout } : {}) });
    }
    // A generated region's mark (src/output-region.ts): one `[ ]` stop in the gutter beside its first row, over its rows.
    for (const r of doc.regions ?? []) {
      const info = this.regionInfo.get(r.key);
      if (!info) continue;
      const kind = (info.target.role ?? "link") as ElementKind;
      out.push({ key: keyOf(kind, info.target), kind, row: top + r.row, from: this.gutterStart, to: this.gutterStart + 1, ruler: [top + r.row, top + r.row + r.rows], label: info.label, link: info.target, region: r.key });
    }
    for (const x of doc.media) {
      const image = imageRef?.(x.line) ?? undefined;
      out.push({ key: keyOf("link", { media: x.path }), kind: "link", row: top + x.row, from: this.bx, to: this.bx + width(doc.lines[x.row] ?? ""), ruler: block(x.row), label: x.path.split("/").pop() ?? x.path, link: { media: x.path, ...(image ? { image } : {}) } });
    }
    // A code block and a quote (a callout is an element already): `[ ]` stops on them so y copies one (PIE-638).
    doc.blocks.forEach((b, n) => {
      if (b.kind === "callout") return;
      if (b.kind === "span") {
        out.push({ key: `block:span:${b.row}:${b.col}`, kind: "block", row: top + b.row, from: b.col + this.bx, to: (b.to ?? b.col) + this.bx, ruler: [top + b.row, top + b.row + b.rows], item: [top + b.row, top + b.row + b.rows], label: `code · ${ellipsize(b.text, 40)}`, block: n });
        return;
      }
      const lines = b.text.split("\n").length;
      out.push({ key: `block:${b.kind}:${b.line}`, kind: "block", row: top + b.row, from: this.bx, to: this.bx + Math.max(1, b.col), ruler: [top + b.row, top + b.row + b.rows], label: `${b.kind === "code" ? "code block" : "quote"}, ${lines} line${lines === 1 ? "" : "s"}`, block: n });
    });
    for (const k of marks) out.push({ key: `comment:${k.thread}`, kind: "comment", row: top + k.row,
      from: this.gutterStart + 1 + (k.col ?? 0), to: this.gutterStart + 1 + (k.col ?? 0) + 3,
      ruler: [top + k.rows[0], top + k.rows[1]], label: k.label, thread: k.thread });
    const quoteOf = new Map(marks.map(k => [k.thread, k.label.split(" · ")[0]!]));
    for (const c of controls) if (!out.some(e => e.key === controlKey(c.thread, c.control, c.value))) out.push({ key: controlKey(c.thread, c.control, c.value), kind: "control", row: top + c.row, from: c.from + this.bx, to: c.to + this.bx, ruler: [top + c.row, top + c.row + 1], label: `${c.label} · ${quoteOf.get(c.thread) ?? "a thread"}`, thread: c.thread, control: c.control, ...(c.value !== undefined ? { value: c.value } : {}) });
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
    if (spec.quote !== undefined && findQuote(m.text, spec.quote, spec.near) < 0) throw new ActionRefused(`"${spec.quote}" isn't in the note's current text`);
    const rows = this.focusRows(spec, m, d.doc, d.lines, d.top);
    if (!rows) {
      if (spec.block !== undefined) throw new ActionRefused(`this note doesn't embed or link ${spec.block} where it's drawn; to mark another note, open it first`);
      throw new ActionRefused("nothing of that is drawn here (past the end, only properties, or in a folded section; unfold it first)");
    }
    const q = spec.quote?.trim() ?? "";
    const label = spec.quote !== undefined ? `"${q}"`
      : spec.line !== undefined ? `line${spec.to && spec.to !== spec.line ? `s ${spec.line}–${spec.to}` : ` ${spec.line}`}`
      : sameId(spec.block!, m.id) ? "this note" : (this.elems.find(e => sameId(spec.block!, e.link?.block))?.label ?? spec.block!);
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
  setFigureTab(f: FigureInfo, value: string, select: boolean, host: SurfaceHost) {
    this.figureUI.set(f.key, { ...this.figureUI.get(f.key), tab: value });
    f.tab = value;
    if (select && this.inView()?.link?.figure?.figure === f.key) {
      this.cur = `${figureElemBase({ figure: f.key, tab: value })}#0`; this.link = -1; this.reveal = true;
      // Another key in this input chunk must see the new tab's rows before the host paints.
      const d = this.drawn, digest = this.digested;
      withFigureBoard(host.ctx.board, () => host.redraw(), () => {
        if (d) this.renderReading(d.w, d.h, host, null);
        else if (this.digesting && digest) this.digest(digest.m, digest.w, host, digest.maxImageRows);
      });
    }
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
    if (ch(k) === "=" && (f.kind === "tabs" || f.kind === "table")) return { name: "figure.density", args: { figure } };
    if (k.kind === "enter" && e?.kind === "figure") return e.link?.figure?.tab !== undefined ? { name: "figure.tab", args: { figure, tab: e.link.figure.tab } } : { name: "figure.density", args: { figure } };
    return null;
  }

  /**
   * A key this reader takes ahead of its host's own while a live figure's element is current (tab and shift+tab
   * cycle a desk's tiles, ← → step a river's columns or a BBS reader's messages otherwise): the host asks first.
   */
  claims(k: Key): boolean { return this.modes.get("form") !== null || (!!this.currentFigure() && (isUp(k) || isDown(k))) || !!this.figureKey(k) || (!!this.imageKey(k) && ch(k) !== "H"); }

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
    else if ("open" in c) void this.runKey("artifact.open", { line }, host);
    else if ("share" in c) void this.runKey("artifact.share", { line }, host);
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
    return im && d ? (im.cols / Math.max(1, d.w - d.bx - this.bxRight)) * 100 : null;
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
  /** Which of `m`'s images is its header: the first `[layout::hero]` line (PIE-1361), the one place that decides it. */
  heroRef(m: Msg) { return this.imagesIn(m).find(x => x.spec.layout === "hero"); }
  /** The note's header image as the tune shows it (PIE-1361): its line, its file, its look as written, its rows drawn; null when it has none. */
  heroInfo(m: Msg): { line: number; name: string; values: Partial<Record<HeroProp, string>>; rows: number | null } | null {
    const ref = this.heroRef(m);
    if (!ref) return null;
    const values = Object.fromEntries(HERO_PROP_NAMES.flatMap(p => { const v = heroPropText(ref.spec, p); return v === undefined ? [] : [[p, v]]; }));
    return { line: ref.line, name: ref.path.split("/").pop() ?? ref.path, values, rows: this.hero?.line === ref.line ? this.hero.full : null };
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
    if (standsAsPerson(actor, host.ctx.person?.() ?? NOBODY, "tile")) this.reveal = true;
    const said = `image ${printable(name)}: ${what}`;
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
    return this.act(c.tab !== undefined ? "figure.tab" : "figure.density", c.tab !== undefined ? { figure: String(f.n), tab: c.tab } : { figure: String(f.n) }, host, actor);
  }

  pressFigure(c: FigureControl, host: SurfaceHost) {
    const f = this.figuresDrawn.find(x => x.key === c.figure);
    if (!f) return;
    if (c.tab !== undefined) void this.runKey("figure.tab", { figure: String(f.n), tab: c.tab }, host);
    else void this.runKey("figure.density", { figure: String(f.n) }, host);
  }

  buttonHint(): string[] {
    const press = this.inView()?.link?.press;
    return press?.steps?.map((step, i) => `${i + 1}. ${step.kind}: ${step.source}`) ?? [];
  }

  statusButtonLine(label?: string): string | null {
    const m = this.msg;
    if (!m) return null;
    const call = this.inView()?.link?.press;
    const buttons = buttonCallsOf(m.text).filter(b => b.act);
    const hits = label !== undefined ? buttons.filter(b => b.label === label)
      : call?.block === m.id ? buttons.filter(b => b.line === call.line)
      : buttons.length === 1 ? buttons : [];
    return hits.length === 1 ? m.text.split("\n").slice(hits[0]!.line, hits[0]!.endLine + 1).join("\n") : null;
  }

  describeElements() {
    return this.elems.map((e, i) => ({
      n: i + 1, kind: e.kind, label: printable(e.label), current: e.key === this.cur,
      ...(e.link ? { target: e.link.block ?? e.link.page ?? e.link.media ?? e.link.url } : {}), ...(e.thread ? { thread: e.thread } : {}), ...(e.control ? { control: e.control } : {}),
      ...(e.link?.proposal?.op ? { control: e.link.proposal.op, proposal: e.link.proposal.id } : {}),
      ...(e.link?.unsent ? { control: e.link.unsent.op, unsent: e.link.unsent.kind } : {}),
      // An inline ::links component's (PIE-693): a row of it, or its ⏎ in control, and which component (list.blocks numbers them).
      ...(e.link?.inlineList ? { list: { row: e.link.inlineList.row + 1, total: this.inlineLists.get(e.link.inlineList.key)!.rows.length, top: this.inlineLists.get(e.link.inlineList.key)!.view.top } } : {}),
      ...(e.link?.listRow ? { links: { block: (this.linkBlocksDrawn.find(b => b.key === e.link!.listRow!.key)?.n ?? null), [e.link.listRow.row ? "row" : "control"]: true } } : {}),
    }));
  }

  // ── copying a block (PIE-638) ──────────────────────────────────────────────

  /** The document the last render drew, with the content row its first row is at (a river column's digest starts at 0). */
  private blockDoc(): { doc: Doc; top: number } | null {
    if (this.drawn) return { doc: this.drawn.doc, top: this.drawn.top };
    return this.digesting && this.digested ? { doc: this.digested.doc, top: 0 } : null;
  }

  /** The code block, quote or callout (index into `doc.blocks`) element `e` is, or is inside (the innermost); null for none. */
  blockOf(e: Element): number | null {
    if (e.block !== undefined) return e.block;
    const bd = this.blockDoc();
    if (!bd) return null;
    let best: number | null = null;
    bd.doc.blocks.forEach((b, n) => {
      if (b.kind === "span") return;
      if (e.row >= bd.top + b.row && e.row < bd.top + b.row + b.rows && (best === null || b.rows < bd.doc.blocks[best]!.rows)) best = n;
    });
    return best;
  }

  /** The blocks the last render drew, as `blocks` lists them: number, kind, the note lines (from 1) and the first words. */
  describeBlocks() {
    const bd = this.blockDoc();
    if (!bd) return [];
    return bd.doc.blocks.map((b, i) => {
      const text = this.blockText(b), lines = text.split("\n").length;
      return { n: i + 1, kind: b.kind, lines, from: (this.drawnLines()[b.line] ?? b.line) + 1, to: (this.drawnLines()[b.end - 1] ?? b.end - 1) + 1, text: printable(text.split("\n")[0] ?? ""), current: this.blockOfCurrent() === i };
    });
  }

  /** A block's content as the note has it written (links, styles and inner quotes as typed), else as the document has it. */
  private blockText(b: DocBlock): string {
    const m = this.drawn ? this.msg : this.digested?.m, lines = this.drawnLines();
    if (b.kind === "span" || !m || !lines.length) return b.text;
    const raw = m.text.split("\n"), out: string[] = [];
    for (let k = b.inner[0]; k < b.inner[1]; k++) { const n = lines[k]; if (n !== undefined) out.push(stripQuotes(raw[n] ?? "", b.strip)); }
    return out.join("\n").trimEnd();
  }

  /** The block (number from 1) element `n` (from 1) is or is in; refused for one in no block. */
  blockNumberOf(n: number): number {
    const i = this.blockOf(this.element(n));
    if (i === null) throw new ActionRefused(`element ${n} is in no code block, quote, callout or code span`);
    return i + 1;
  }
  /** The block (number from 1, as `blocks` lists them) the person's current element is, or is in; null for none. A host's `y` asks it. */
  currentBlock(): number | null { const n = this.blockOfCurrent(); return n === null ? null : n + 1; }
  /** The note line (from 0, the subject) of each body line of the last render. */
  private drawnLines(): readonly number[] { return this.drawn?.lines ?? this.digested?.lines ?? []; }
  private blockOfCurrent(): number | null { const e = this.inView(); return e ? this.blockOf(e) : null; }

  /**
   * The text of block `n` (from 1, `blocks` lists them; left out, the one the current element is in): the content as written,
   * without a fence's lines, a quote's `>` markers or a callout's marker line. The person's goes to their clipboard (OSC 52) and
   * is said as "copied N lines"; an agent's is only returned.
   */
  copyBlock(n: number | undefined, host: SurfaceHost, actor: Actor): { n: number; kind: DocBlock["kind"]; text: string; lines: number; clipboard: boolean } {
    const bd = this.blockDoc();
    if (!bd) this.requireDrawn();
    const cur = actor.kind === "user" ? this.inView() : null;
    const i = n !== undefined ? n - 1 : cur ? this.blockOf(cur) : null;
    if (i === null || i === undefined) throw new ActionRefused(n === undefined && actor.kind === "agent" ? "say which block: n (blocks lists them)" : "no code block, quote or callout is the current element; [ ] to one, or pass n (blocks lists them)");
    const drawn = bd?.doc.blocks[i];
    if (!drawn) throw new ActionRefused(`there is no block ${i + 1}; the reader draws ${bd?.doc.blocks.length ?? 0} (blocks lists them)`);
    const b = { ...drawn, text: this.blockText(drawn) };
    if (!b.text.trim()) throw new ActionRefused(`the ${b.kind === "code" ? "code block" : b.kind} has nothing in it to copy`);
    const lines = b.text.split("\n").length, chars = [...b.text].length;
    const said = b.kind === "span" ? `${chars} char${chars === 1 ? "" : "s"}` : `${lines} line${lines === 1 ? "" : "s"}`;
    if (actor.kind === "user") {
      // Over COPY_MAX nothing is copied: App.copy's toast says why, and the action is refused.
      if (host.ctx.copy?.(b.text) === false) throw new ActionRefused(`not copied: ${[...b.text].length} chars is more than the clipboard takes`);
      host.ctx.flash(`copied ${said}`);
      return { n: i + 1, kind: b.kind, text: b.text, lines, clipboard: true };
    }
    host.ctx.flash(`copied ${said} for itself · your clipboard is untouched`);
    this.noteAgent(actor, `copied ${said} of ${b.kind === "code" ? "a code block" : b.kind === "span" ? "a code span" : "a " + b.kind}`);
    return { n: i + 1, kind: b.kind, text: b.text, lines, clipboard: false };
  }

  /**
   * The whole note's text, as stored (header chips, fences and all), with each live figure's results under it as Markdown
   * (PIE-1355, page-results.ts: the rows this reader draws, capped, a cut said with the command that reads the rest);
   * `source` copies the text alone. The person's goes to their clipboard (OSC 52) and is said as "copied the page with N
   * figures' results"; an agent's is only returned. Works whatever the reader draws.
   */
  async copyNote(host: SurfaceHost, actor: Actor, source = false): Promise<{ id: string; text: string; lines: number; clipboard: boolean; figures: number; cut: number; unanswered: number }> {
    const m = await this.whole();
    if (!m.text.trim()) throw new ActionRefused("the note has nothing in it to copy");
    // Where the command that reads a cut figure's rest is pointed: this tile's outline, and the machine it is on when not here.
    const outline = m.address?.outline ?? host.ctx.board.outline ?? host.ctx.outline, machine = m.address?.machine ?? host.ctx.machine;
    const page = source ? { text: m.text, figures: 0, cut: 0, unanswered: 0 } : await pageWithResults(host.ctx.board, m.text, m.id, { ...(outline ? { outline } : {}), ...(machine ? { machine } : {}), at: Date.now() }, 5_000);
    const text = page.text, lines = text.split("\n").length;
    // A figure the outline didn't answer in time says so in the copy, and here.
    const late = page.unanswered ? ` · ${page.unanswered} figure${page.unanswered === 1 ? "" : "s"} not answered in time` : "";
    const said = page.figures
      ? `copied the page with ${page.figures} figure${page.figures === 1 ? "'s" : "s'"} results${page.cut ? ` (${page.cut} cut)` : ""}, ${lines} lines${late}`
      : `copied the note${source ? "'s source" : ""}, ${lines} line${lines === 1 ? "" : "s"}${late}`;
    const r = { id: m.id, text, lines, figures: page.figures, cut: page.cut, unanswered: page.unanswered };
    if (actor.kind === "user") {
      if (host.ctx.copy?.(text) === false) throw new ActionRefused(`not copied: ${[...text].length} chars is more than the clipboard takes${page.figures ? " · the source alone: note.copy source=true" : ""}`);
      host.ctx.flash(said);
      return { ...r, clipboard: true };
    }
    host.ctx.flash(`${said}, for itself · your clipboard is untouched`);
    this.noteAgent(actor, said);
    return { ...r, clipboard: false };
  }

  /**
   * `note.copy-ref` (PIE-1297) in a reader: the note's id, reference or web link (`noteRefText`), or a reference to one
   * line, `((id^anchor|words))`, minting the anchor when it has none (`fragments.ensure`, attributed, as `fields.anchor`
   * does). The line is `line` (from 1); else the actor's own selection's first line; the person's falls back to the
   * heading the keys selected, then the line being read. `own`: this door's outline, so another's note is named with
   * its outline. The person's goes to their clipboard; an agent's is returned to it.
   */
  async copyNoteRef(kind: NoteRefKind, host: SurfaceHost, actor: Actor, own: string | undefined, line?: number): Promise<{ id: string; kind: string; text: string; clipboard: boolean; line?: number; anchor?: string; created?: boolean }> {
    const m = await this.whole();
    const where = { outline: m.address?.outline ?? own, foreign: !!m.address?.outline && m.address.outline !== own };
    if (kind !== "line") return deliverNoteRef(host.ctx, actor, m.id, kind, noteRefText(kind, m, where), said => this.noteAgent(actor, said));
    const { at, next } = this.refLine(m, actor, line), board = host.ctx.board;
    if (m.revision === undefined) throw new ActionRefused("this note has no revision to anchor a line at");
    // The part of the note holding the line (a heading, a paragraph, a list item, a quote, a component), as the service
    // reads it: its anchor goes where that part's goes, and its label is the part's own.
    const found = await board.partAt(m.id, at, next), part = found.part;
    // The line was chosen in the text this reader read: a note saved since may hold another part there.
    if (found.revision !== m.revision) throw new ActionRefused("the note changed since it was read; it is read again, copy once more");
    if (!part) throw new ActionRefused(`line ${at + 1} is in no part of the note that takes an anchor (a heading, a paragraph, a list item, a quote, a component)`);
    let anchored: { fragmentId: string; created: boolean };
    try { anchored = part.fragmentId ? { fragmentId: part.fragmentId, created: false } : await board.ensureFragment(m.id, part.lineIndex, m.revision, actor); }
    catch (e) {
      const said = e instanceof Error ? e.message : String(e);
      throw new ActionRefused(/changed since/.test(said) ? "not anchored: the note changed since it was read; it is read again, copy once more" : `not anchored: ${said}`);
    }
    const text = noteRefText("line", m, where, { anchor: anchored.fragmentId, text: part.label });
    return { ...deliverNoteRef(host.ctx, actor, m.id, "line", text, said => this.noteAgent(actor, said)), line: at + 1, anchor: anchored.fragmentId, created: anchored.created };
  }

  /**
   * The source line (from 0) a line's reference names for `actor` (copyNoteRef); `next`: it is only where the person is
   * reading, so the first part from there counts (the title at the top of the view takes no anchor).
   */
  private refLine(m: Msg, actor: Actor, line: number | undefined): { at: number; next: boolean } {
    const count = m.text.split("\n").length;
    if (line !== undefined) {
      if (!Number.isInteger(line) || line < 1 || line > count) throw new ActionRefused(`line is from 1 to ${count}`);
      return { at: line - 1, next: false };
    }
    const sel = actor.kind === "user" ? this.selection : this.agentSelection?.id === actor.id ? this.agentSelection.sel : null;
    const src = sel ? this.sourceOf(sel, true) : null;
    if (src) return { at: src.lines[0], next: false };
    if (actor.kind !== "user") throw new ActionRefused("name the line: line=<from 1>, or select in the note first (the person's selection is theirs)");
    const folded = this.foldSel ? this.visibleFolds(m).find(p => p.key === this.foldSel) : undefined;
    const heading = folded ? this.foldsIn(m).lines[folded.line] : undefined;
    return heading !== undefined ? { at: heading, next: false } : { at: this.readingSourceLine(), next: true };
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

  inlineRowElement(e: Element, row: number): Element {
    const key = e.link?.inlineList?.key;
    if (key === undefined) throw new ActionRefused("this element is not in an inline list");
    const list = this.inlineLists.get(key)!, item = list.rows[row];
    if (!item) throw new ActionRefused(`row must be from 1 to ${list.rows.length}`);
    return { ...e, key: inlineRowKey(key, item.target), link: item.target, label: item.label };
  }

  selectInlineRow(e: Element, row: number) {
    const item = this.inlineRowElement(e, row);
    const list = this.inlineLists.get(item.link!.inlineList!.key)!;
    this.selectElement(item);
    list.view.reveal();
    this.laid = null;
    return { row: row + 1, total: list.rows.length, label: item.label };
  }

  scrollInline(n: number, by: number) {
    const key = this.element(n).link?.inlineList?.key;
    if (key === undefined) throw new ActionRefused("this element is not in an inline list");
    this.inlineLists.get(key)!.view.scroll(by);
    this.laid = null;
  }
  /** `element.open`: ⏎ on element `e` (see enterElement). */
  openElement(e: Element, host: SurfaceHost, fresh: boolean, select: boolean, actor: Actor = USER) { return this.enterElement(e, host, { fresh, select, actor }); }

  /**
   * A click in the last render (`x`, `y` in the surface's cells). While an edit, a comment or a value
   * being typed holds the surface, only a completion candidate takes it (chosen and inserted, as Enter
   * does). Otherwise a link opens where ⏎ on it would (and becomes the selected `[ ]` link when it is one
   * of them); a property panel row is selected, and a click on its linked value follows it. Elsewhere on
   * a heading, or on a list item's mark, it folds or unfolds it (clickFold). False when nothing is there.
   */
  click(x: number, y: number, host: SurfaceHost): boolean {
    this.use(host);
    const formHit = !this.draft && this.formHit(x, y);
    if (formHit && "link" in formHit && formHit.link.form) {
      const field = formHit.link.form.field, spec = this.form?.fields.find(f => f.name === field);
      if (spec && spec.type !== "choice") {
        void this.runKey("form.place", { field, col: x - formHit.from }, host);
        return true;
      }
    }
    if (this.placementMenu) return this.modes.click(x, y, host) ?? false;
    if (this.listEditor.field) return this.modes.click(x, y, host) ?? false;
    const pr = this.listPreview.rect;
    if (this.previewPoint() && pr && (host.attachment === "list-preview" || !host.attachment && !host.hasWiredPreview?.()) && x >= pr.col && x < pr.col + pr.cols && y >= pr.row && y < pr.row + pr.rows) {
      if (y === pr.row && !host.hasWiredPreview?.() && x >= pr.col + pr.cols - `[${this.listPreview.place} ▸]`.length) void this.runKey("placement.menu", { target: "list-preview" }, host);
      else if (y > pr.row) {
        const hit = this.previewHits.find(h => h.row === y && x >= h.from && x < h.to);
        if (hit) void this.open(hit.link, host);
        else void this.runKey("list.preview.edit", {}, host);
      }
      return true;
    }
    // The note's rows are under its header image (PIE-532).
    y -= host.attachment ? 0 : this.drawn?.heroRows ?? 0;
    // The `[ ]` position as the click found it: a click's own reading.place lets go of it first.
    const was = this.cur;
    const float = this.floatAt(x, y + (this.drawn?.heroRows ?? 0), host);
    if (float) { this.modes.get(float)?.click(x, y, host); return true; }
    const h = this.hitAt(x, y);
    if (h && "listPreview" in h) { void this.runKey("list.preview", { n: h.listPreview }, host); return true; }
    if (h && "sources" in h) { void this.runKey("sources.open", {}, host); return true; }
    if (h && "zoom" in h) { void this.runKey("element.zoom", h.zoom < 0 ? { on: false } : { line: h.zoom + 1 }, host); return true; }
    // An open mode first (in its precedence): the edit's or comment's own click, a status choice's row, a panel row.
    const taken = this.modes.click(x, y, host);
    if (taken !== undefined) return taken;
    if (!this.editing && !host.attachment) {
      const line = this.sourceLineAt(y + (this.drawn?.heroRows ?? 0));
      const p = this.msg && this.foldsIn(this.msg).points.find(p => this.foldsIn(this.msg!).lines[p.line] === line && this.previews(p));
      if (p && !(h && "link" in h)) {
        const e = this.elems.find(e => e.key === `fold:${p.key}`);
        if (e) { void this.runKey(was === e.key ? "element.open" : "element.select", { n: this.elems.indexOf(e) + 1 }, host); return true; }
      }
    }
    if (!this.editing) { const line = this.sourceLineAt(y + (this.drawn?.heroRows ?? 0)); if (line !== null) void this.runKey("reading.place", { line: line + 1 }, host); }
    // The header image: a click on it makes it the `[ ]` position, as a click on any image does.
    if (y < 0) { const i = this.elems.findIndex(e => !!e.link?.media && e.link.image?.line === this.hero?.line); if (i >= 0) void this.runKey("element.select", { n: i + 1 }, host); return i >= 0; }
    // Each click is the action its key is (PIE-506): copy, back and forward, select.clear, element.open, …
    if (h && "fold" in h) { void this.runKey("fold.toggle", { n: h.fold }, host); return true; }
    // A generated region's mark (src/output-region.ts): the `[ ]` position goes to it, which shows what is behind it; a second click lets go.
    if (h && "region" in h) {
      const e = this.elems.find(x => x.region === h.region);
      if (!e) return false;
      if (e.key === was) { this.letGo(); host.redraw(); }
      else void this.runKey("element.select", { n: this.elems.indexOf(e) + 1 }, host);
      return true;
    }
    if (h && "copy" in h) { void this.runKey("select.copy", h.copy === "source" ? { source: true } : {}, host); return true; }
    // The copy control on a code block, a quote or a callout (PIE-638): block.copy, as y on it.
    if (h && "block" in h) {
      // A code span becomes the `[ ]` position (its row tinted for a moment), then copies as y on it does.
      const span = this.blockDoc()?.doc.blocks[h.block]?.kind === "span" ? this.elems.find(e => e.block === h.block) : undefined;
      if (span) this.setElem(span);
      void this.runKey("block.copy", { n: h.block + 1 }, host);
      host.redraw();
      return true;
    }
    if (h && "history" in h) { void this.runKey(historyAction(h.history), {}, host); return true; }
    // The crumbs: the note in the outline (reader.reveal: the outline's cursor moves there, nothing else, PIE-794).
    if (h && "crumbs" in h) { host.revealInOutline?.(); return true; }
    // The byline's [comment] (PIE-846): as its key would, where the host keeps track of the person's session.
    // The byline's comment count (PIE-873): the margin's next mode, as M.
    if (h && "margin" in h) { void this.runKey("margin", {}, host); return true; }
    if (h && "start" in h) { if (host.startSession) void host.startSession(h.start); else void this.startAsPerson(h.start, host); return true; }
    // A chip of the passage toolbar (ADR 0004 contract 5): what its key after `a` does, on the person's selection.
    if (h && "passage" in h) { this.passageMenu = false; this.passagePick(h.passage, host); return true; }
    // A click anywhere else lets go of the selection, and does what it always did.
    if (this.selection) void this.runKey("select.clear", {}, host);
    if (!h) return false;
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
    return this.pressLink(h.link, h.elem ? this.elems.find(e => e.key === h.elem) : undefined, was, h.value, !!host.freshClick, host);
  }

  /**
   * A click on a link the surface drew, wherever its host drew it (a reader's own rows, the river's column, PIE-1392): the
   * one place that decides what the click does. `e` is its element, `was` the `[ ]` position before the click, `value` a
   * summary-line value's key, `fresh` an alt-, ctrl- or middle-click.
   */
  private pressLink(link: Link, e: Element | undefined, was: string | null, value: string | undefined, fresh: boolean, host: SurfaceHost): boolean {
    // A proposal's [apply] or [dismiss] (PIE-501): it becomes the `[ ]` position, and its action runs.
    const pc = link.proposal;
    if (pc?.op) { if (e) this.setElem(e); host.redraw(); void this.proposalControl(pc.op, pc.id, host); return true; }
    // An `■ unsent` line's control: it becomes the `[ ]` position, and its action runs.
    const uc = link.unsent;
    if (uc) { if (e) this.setElem(e); host.redraw(); void this.runKey(`unsent.${uc.op}`, { kind: uc.kind }, host); return true; }
    // A live figure's tab or density: it becomes the `[ ]` position, and figure.tab or figure.density runs.
    if (link.role === "figure" && link.figure) { if (e) this.setElem(e); this.pressFigure(link.figure, host); host.redraw(); return true; }
    // An image's caption control (PIE-532): the image becomes the `[ ]` position, and the control's action runs.
    if (link.role === "image" && link.image) { this.pressImage(link.image, host); return true; }
    // A row of an inline ::links (PIE-693), as a links tile's row (PIE-794, one list model): a click selects it (the [ ]
    // position; its preview and a preview linked to this reader follow), a second click on it soon after opens it (⏎),
    // an alt-, ctrl- or middle-click opens it fresh (alt+⏎); the click that gives the reader the keys only selects.
    const lbk = link.listRow;
    // A figure's row is a list row like any other (Evan, Oct 21: a click selects and previews; it never opens at once).
    // A row that stands for a query, not a note (a live calendar's day, an activity cell), has nothing to preview: one
    // click lists its notes, as ⏎ on it does (PIE-1457).
    if (e && (lbk?.row || e.link?.inlineList) && link.query === undefined && !host.opensOnClick?.(link)) {
      const i = this.elems.indexOf(e), inline = e.link?.inlineList;
      const presses = inline ? this.inlineLists.get(inline.key)!.view : this.linkPresses;
      const g = presses.press(inline?.row ?? i, { focusing: !!host.focusing, selected: e.key === was });
      void this.runKey(g === "open" || (g === "select" && fresh) ? "element.open" : "element.select", { n: i + 1, ...(fresh ? { fresh: true } : {}) }, host);
      host.redraw();
      return true;
    }
    // A step's box: its status choice opens under it, as ⏎ on it does (PIE-472); a link (or a summary-line
    // value) opens where ⏎ on it would. Both are element.open on that element.
    // alt+click: a button's alt=, or, on one with slots and no alt= of its own, asking for its slots again (PIE-1298).
    if (e) { void this.runKey(e.link?.press ? "button.press" : "element.open", { n: this.elems.indexOf(e) + 1, ...(fresh && e.link?.press ? { alt: true } : {}) }, host); host.redraw(); return true; }
    const i = this.links.findIndex(x => sameLink(x, link));
    if (i >= 0 && value === undefined) { void this.runKey("link.follow", { n: i + 1 }, host); return true; }
    // A link drawn outside the note's elements and links (none today): opened as ⏎ on it would.
    host.redraw();
    if (value !== undefined) void this.followValue({ key: value, target: link.block ? { block: link.block } : { page: link.page! } }, host, { link: true });
    else void this.followTarget(link, host, { link: true });
    return true;
  }

  /**
   * A click on a link a host drew itself from the digest (the river's note body, PIE-1392): its element gets the reader's
   * click (`pressLink`: a button presses, a list row selects then opens, a step opens its choice); a picker row or a link
   * outside the elements opens as `open` does. A host that kept its rows from an earlier draw holds that draw's link, so
   * the element is found by what it is.
   */
  clickLink(l: Link, host: SurfaceHost, fresh = false): void {
    if (l.choice === undefined) {
      const el = this.elems.find(x => x.link === l) ?? this.elems.find(x => !!x.link && sameElementLink(x.link, l));
      if (el) { this.pressLink(l, el, this.cur, undefined, fresh, host); return; }
    }
    void this.open(l, host, fresh);
  }

  /**
   * Open a link the host drew itself (the river's note body): it becomes the selected `[ ]` link when
   * it is one of them, then opens where ⏎ on it would.
   */
  open(l: Link, host: SurfaceHost, fresh = false): Promise<Msg | Outside | TagList | null> {
    // A step's box opens its status choice; a row of an open choice chooses it (PIE-472).
    if ((l.role === "task" || l.role === "callout") && l.choice !== undefined) { void this.choose(l.choice, host); return Promise.resolve(null); }
    if (l.role === "callout" && l.callout) {
      const e = this.elems.find(x => x.link === l) ?? this.elems.find(x => x.callout && calloutBase(x.callout) === calloutBase(l.callout!));
      if (e) { this.openCalloutPicker(e); host.redraw(); }
      return Promise.resolve(null);
    }
    if (l.proposal?.op) { void this.proposalControl(l.proposal.op, l.proposal.id, host); return Promise.resolve(null); }
    if (l.unsent) { void this.runKey(`unsent.${l.unsent.op}`, { kind: l.unsent.kind }, host); return Promise.resolve(null); }
    if (l.anchor) { void this.runKey("fields.anchor", { key: l.anchor.key, n: l.anchor.n }, host); return Promise.resolve(null); }
    if (l.use) { void this.runKey("use.fill", { block: l.use.block, line: l.use.line + 1 }, host); return Promise.resolve(null); }
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
  private openOutside(where: Outside["outside"], url: string, host: SurfaceHost): Outside | Promise<Outside> {
    const by = host.actor, app = where === "browser" ? "the browser" : "the system viewer";
    if (by?.kind === "agent") {
      this.noteAgent(by, `was given ${url} · an agent doesn't open ${app}`);
      host.ctx.flash(`was given ${url} · an agent doesn't open ${app}`);
      host.redraw();
      return { outside: where, url, launched: false };
    }
    if (opensRemotely()) {
      if (where === "viewer") throw new ActionRefused(`the file is on the machine running the door: ${url}; use a web URL to open it on your own machine`);
      return openRemote(url, host.ctx).then(launched => ({ outside: where, url, launched }));
    }
    external.run(where === "browser" ? externalOpenCommand(url) : fileOpenCommand(url));
    host.ctx.flash(`opened ${where === "browser" ? url : "it"} in ${app}`);
    return { outside: where, url, launched: true };
  }

  /** A link to this artifact alone for someone outside (PIE-1266), copied for the person; an agent is given it in the answer. */
  async shareArtifact(ref: ImageRef, ttl: string | undefined, host: SurfaceHost, actor: Actor): Promise<{ share: ShareSession; said?: string }> {
    const artifact = await host.ctx.board.request<ArtifactInfo>("artifacts.show", { name: ref.path });
    if (artifact.deploy) throw new ActionRefused(`${artifact.deploy.repo} is a repo: its site${artifact.url ? ` (${artifact.url})` : ""} is public already, and a share gives a stored artifact alone; artifact.open opens the site`);
    const started = await startShare(host.ctx.board, { artifact: artifact.version ? `${artifact.name}@${artifact.version}` : artifact.name, ...(ttl ? { ttl } : {}) }, actor);
    const { share } = started;
    if (actor.kind === "user" && share.url) host.ctx.copy?.(share.url, "share link");
    host.ctx.flash(`${share.url && actor.kind === "user" ? "copied the link · " : ""}shared ${artifact.name} alone for ${endsIn(share.expiresAt)}${share.url ? `: ${share.url}` : ` · ${started.said ?? ""}`} · share.revoke id=${share.id} ends it`, 15_000);
    return started;
  }

  async openArtifact(ref: ImageRef, host: SurfaceHost): Promise<Outside> {
    const artifact = await host.ctx.board.request<ArtifactInfo>("artifacts.show", { name: ref.path });
    // A repo opens its live site; one that isn't live says why and the command that deploys it (PIE-1060).
    if (artifact.deploy && !artifact.url) throw new ActionRefused(`${artifact.deploy.repo} isn't live: ${artifact.deploy.said ?? artifact.deploy.state}${artifact.deploy.command ? `; run ${artifact.deploy.command}` : ""}`);
    if (!artifact.url) throw new ActionRefused("Set EP0CH_WEB_URL on the outline host to the web client's address (https://my.ep0ch.sh): an artifact opens as its page there.");
    return this.openOutside("browser", artifact.url, host);
  }

  /** Open what a link names: media in the system viewer, web pages in the browser (openOutside), blocks and pages through the host (`how`, where). */
  private async followTarget(l: Link, host: SurfaceHost, how: OpenHow = { link: true }): Promise<Msg | Outside | TagList | null> {
    if (l.query !== undefined) {
      if (!host.query) { host.ctx.flash(`${l.query}: this screen has nowhere to list notes · / searches the outline`); return null; }
      return host.query(l.query, { ...how, ...(host.actor ? { by: host.actor } : {}) });
    }
    // A `#tag` (PIE-800): the notes carrying it, listed where the host lists them (the desk: a query tile beside this reader).
    if (l.tag !== undefined) {
      if (!host.tag) { host.ctx.flash(`#${l.tag}: this screen has nowhere to list the notes carrying it · / searches #${l.tag}`); return null; }
      return host.tag(l.tag, { ...how, ...(host.actor ? { by: host.actor } : {}) });
    }
    // An artifact's card (PIE-793) opens it running on its web page: as an element (with its line), or as one of the
    // note's followable links (its path alone: the note's artifact line that names it).
    if (l.media && l.image && parseMediaLine(l.image.source)?.kind === "artifact") return this.openArtifact(l.image, host);
    const named = l.media && !l.image && this.msg ? this.imagesIn(this.msg).find(x => x.path === l.media && x.spec.kind === "artifact") : undefined;
    if (named) return this.openArtifact(named, host);
    if (l.media) return this.openOutside("viewer", l.media, host);
    // A resource token: its Resource's stored content, registered and fetched first if it must be (src/authored.ts).
    if (l.resource) {
      const addressed = addressedResource(l.resource);
      if (addressed) return this.followTarget(addressed, host, how);
      const to = resourceTarget(l.resource);
      if ("refused" in to) { host.ctx.flash(to.refused); return null; }
      host.ctx.flash(`reading ${l.resource.label}…`);
      const shown = await openResource(host.ctx.board, to, host.actor ?? USER, this.msg && isOutlineNote(this.msg) ? this.msg.id : undefined).catch((e: Error) => { host.ctx.flash(`couldn't show ${l.resource!.label}: ${e.message}`, undefined, errorDetails(e)); return null; });
      if (!shown) return null;
      this.track(() => host.navigate(shown.note, how));
      if (shown.registered) host.ctx.flash(`${l.resource.label} registered and shown`);
      return shown.note;
    }
    // A Resource an extension's view links to (PIE-754): opened as a resource token's is.
    if (l.resourceRef) {
      const to = resourceRefTarget(l.resourceRef);
      if ("refused" in to) { host.ctx.flash(to.refused); return null; }
      const shown = await openResource(host.ctx.board, to, host.actor ?? USER, this.msg && isOutlineNote(this.msg) ? this.msg.id : undefined).catch((e: Error) => { host.ctx.flash(`couldn't show ${l.resourceRef}: ${e.message}`, undefined, errorDetails(e)); return null; });
      if (!shown) return null;
      this.track(() => host.navigate(shown.note, how));
      if (shown.registered) host.ctx.flash(`${l.resourceRef} registered and shown`);
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
    // A `{{ }}` (PIE-533 S2): where its value is written, lit; else what it is (computed, or why it has no value).
    if (l.value && (!l.block || (l.at === undefined && l.block === this.msg?.id))) {
      host.ctx.flash(l.value.problem ? `${l.value.expression}: ${l.value.problem}` : `${l.value.expression} → ${printable(l.value.words)} · computed (${l.value.route.split(" → ").at(-1)})`, 8000);
      return null;
    }
    let target: Msg | null = null;
    if (!l.outline && l.block) {
      target = await host.ctx.board.get(l.block);
      if (!target) {
        const [resolved] = await host.ctx.board.resolveReferences(`((${l.block}))`);
        if (resolved?.outline) l = { ...l, block: resolved.blockId, outline: resolved.outline, machine: resolved.machine };
      }
    }
    if (!l.outline && l.page) {
      const resolved = await host.ctx.board.resolvePage(l.page);
      if (resolved.outline) l = { ...l, page: resolved.address, outline: resolved.outline, machine: resolved.machine };
    }
    if (l.outline) {
      const ctx = await outlineBoards(host.ctx).on({ outline: l.outline, machine: l.machine ?? host.ctx.machine });
      const address = { outline: l.outline, ...(ctx.machine ? { machine: ctx.machine } : {}) };
      const original = host;
      host = { ...host, ctx, navigate: (m, how) => { m.address = address; original.navigate(m, how); } };
    }
    if (l.block) target ??= await host.ctx.board.get(l.block);
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
    markReveal(target, { ...(l.revision !== undefined ? { revision: l.revision } : {}), ...(l.fragment ? { fragment: l.fragment } : {}), ...(l.at !== undefined ? { at: l.at, ...(l.atLabel ? { label: l.atLabel } : {}), ...(l.atSays ? { says: l.atSays } : l.value ? { says: `the line ${l.value.expression} reads` } : {}) } : {}) }, host.actor ?? USER);
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
  async createPage(address: string, host: SurfaceHost, actor: Actor, standing: boolean): Promise<{ id: string; created: boolean; said?: string }> {
    const r = await host.ctx.board.followPage(address, actor).catch((e: Error) => { throw new ActionRefused(`no page ${address}: ${e.message}`); });
    if (!r.note) throw new ActionRefused(r.status === "deleted" ? `[[${address}]] is a page in the trash: restore it there` : `no page ${address}`);
    const said = r.created ? `created page ${subject(r.note)} ${r.placement?.said ?? ""}`.trim() : `${subject(r.note)} was there already`;
    if (standing) {
      const target = r.note;
      this.track(() => host.navigate(target, { link: true, by: actor, standing }));
      host.ctx.flash(said);
    }
    host.redraw();
    return { id: r.note.id, created: r.created, said };
  }

  /** Reveal the fragment a follow left on `m`, unless it's an agent's and this is the person's focused reader. */
  takeReveal(m: Msg, host: SurfaceHost) {
    const r = revealOn.get(m);
    if (!r) return;
    if (!standsAsPerson(r.by, host.ctx.person?.() ?? NOBODY, "tile") && host.focused !== false) return;
    // Every surface that shows the note takes it once (a preview following the list and the detail it opens in): the mark stays on the note.
    if (this.revealed === r) return;
    this.revealed = r;
    if (r.revision !== undefined) void this.openRevision(host, r.revision, "next").catch((e: Error) => host.ctx.flash(`revision ${r.revision}: ${e.message}`));
    else if (r.fragment) void this.revealFragment(r.fragment, host, r.by);
    else if (r.at !== undefined) void this.revealAt(r.at, host, r.by, r.label, r.says);
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
    const unlaid = this.linkUnlaid !== null && this.cur === null && this.link === this.linkUnlaid ? this.links[this.link] : undefined;
    if (unlaid) this.cur = this.elems.find(e => e.link && sameLink(e.link, unlaid))?.key ?? null;
    if (this.elems.length) this.linkUnlaid = null;
    const loading = !!this.src && (stepsLoading(this.src.board) || embedsLoading(this.src.board));
    if (this.cur && !this.foldSel && !drawn(this.cur)) {
      const a = this.stepRenamed, cur = this.cur;
      const other = !a ? null : cur.startsWith(`${a.now}#`) ? a.was + cur.slice(a.now.length) : cur.startsWith(`${a.was}#`) ? a.now + cur.slice(a.was.length) : null;
      if (other && drawn(other)) { if (this.picker?.key === cur) this.picker.key = other; this.cur = other; }
      // A step isn't let go of while the steps are read again: it's back once they are.
      else if (!(cur.startsWith("task:") && loading) && !this.comments?.some(c => cur.startsWith(`ctl:${c.id}:`))) this.letGo();
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
    // Mark done first, as Detail's menu; on a closed step (done, approved, rejected), Mark to do.
    this.picker = { key: e.key, list: this.choices(stepClosed(e.task.step.status) ? 1 : 0, e.task.live), note: "", busy: false };
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

  /**
   * A status choice's list, from choice `sel`: j k Tab round it, ⏎ or a choice's letter chooses, esc or q cancels. On a
   * live row (`live`, its figure's `done:`) each choice says what it writes on the row's note (`jev::right`), so a
   * figure whose `done:` means "Jev was right" reads as that (PIE-1402).
   */
  choices(sel: number, live?: { key: string; done: string }): Picker["list"] {
    const items = live ? STEP_CHOICES.map(c => c.id === "copy-link" || c.id === "address" ? c : { ...c, label: `${c.label} · ${live.key}::${liveMarkValue(live, c.id)}` }) : STEP_CHOICES;
    const list = new ListPicker<Choice, SurfaceHost>({
      name: "choice", items: () => items, wraps: true, closers: "q", stays: true, row: () => [],
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
    const listed = () => all.slice(0, 12).map((c, i) => `${i + 1} line ${c.line + 1} [!${c.type}] ${calloutTitle(c)}`).join("; ") || "none";
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
    if (change.fold !== undefined && ref.foldKey && standsAsPerson(actor, host.ctx.person?.() ?? NOBODY, "tile")) { if (change.fold === "-") this.folded.add(ref.foldKey); else this.folded.delete(ref.foldKey); }
    const said = `callout ${printable(calloutTitle(ref))}: ${what}`;
    host.ctx.flash(said);
    this.noteAgent(actor, said);
    host.redraw();
    return { block: ref.block, line: ref.line + 1, changed: true, header: next, revision: r.revision ?? null, recordedAs: mutationFor(actor) };
  }

  /** Undo the last callout change `actor` made while reading this note: its header line back, if it still reads as left. */
  /** Undo (ctrl+z, `ext.undo`): the last extension action `actor` ran on this note, its write group whole (PIE-784). */
  async undoExtension(host: SurfaceHost, actor: Actor) {
    const m = this.requireNote();
    const e = EXT_UNDO.last(partyOf(actor), m.id);
    if (!e) throw new ActionRefused(actor.kind === "agent" ? "no extension action or quote you ran on this note to undo" : "no extension action or quote run on this note to undo");
    const say = asActor(host.ctx, actor);
    try {
      host.ctx.scriptUndos?.add(e.undo);
      const r = await host.ctx.board.undoExtension(e.undo, actor);
      EXT_UNDO.drop(e);
      outlineChanged(r.written);
      // The layout the run changed goes back with its writes (PIE-957, one undo id for both): the answer says which parts were
      // undone and which were refused.
      const dispatch = (host.ctx as { dispatch?: import("./dispatch").Dispatcher }).dispatch;
      let layout: { undone: true; steps: number; screen: string; left?: string } | { refused: string } | null = null;
      if (dispatch) {
        try { const l = await dispatch.act({ action: "layout.undo", args: { txn: e.undo } }, actor) as { steps: number; screen: string; left?: string }; layout = { undone: true, steps: l.steps, screen: l.screen, ...(l.left ? { left: l.left } : {}) }; }
        catch (err) { const why = err instanceof Error ? err.message : String(err); if (!/no layout change in transaction/.test(why)) layout = { refused: why }; }
      }
      say.flash(`undid ${e.label.toLowerCase()}${layout && "refused" in layout ? ` · layout not undone: ${layout.refused}` : layout ? ` · layout restored to ${layout.screen}${layout.left ? ` · remaining: ${layout.left}` : ""}` : ""}`);
      host.redraw();
      return { undone: e.undo, action: r.action, written: r.written, ...(layout ? { layout } : {}) };
    } catch (err) {
      host.ctx.scriptUndos?.delete(e.undo);
      const why = `couldn't undo ${e.label.toLowerCase()}: ${err instanceof Error ? err.message : String(err)}`;
      // Gone from the service (undone elsewhere, or the host restarted): it can't be undone here either.
      if (/No extension change/.test(why)) EXT_UNDO.drop(e);
      say.flash(why, undefined, errorDetails(err)); host.redraw();
      throw new ActionRefused(why);
    }
  }

  /**
   * A mark on this note by id (or its first 6+ characters): a thread's comment or highlight, or one of its replies.
   * Several, comma- or space-separated, for a quote of several.
   */
  markIds(named: string): string[] {
    const all = (this.comments ?? []).flatMap(c => [c.id, ...c.replies.map(r => r.id)]);
    const ids = named.split(/[\s,]+/).filter(Boolean).map(n => {
      const id = all.find(x => x === n || (n.length >= 6 && x.startsWith(n)));
      if (!id) throw new ActionRefused(`no mark ${n} on this note (a highlight, comment or reply); peek lists them under comments.threads`);
      return id;
    });
    if (!ids.length) throw new ActionRefused("say which marks: threads=<id>[,<id>…] (a highlight, comment or reply on this note)");
    return [...new Set(ids)];
  }

  /**
   * Quote marks into a new block (`quote`): each transcluded and linked back, where `where` says (`inbox`, `note`,
   * or a block). One write: ctrl+z here (`ext.undo`) takes it back whole. The cards then say "quoted in".
   */
  async quoteMarks(ids: string[], where: string, host: SurfaceHost, actor: Actor, text?: string, open = false) {
    const m = this.requireNote();
    const w = where.trim(), ref = /^!?\(\(([^)|^]+)/.exec(w)?.[1] ?? w;
    const place: QuotePlace = w === "" || w === "inbox" ? { kind: "inbox" } : w === "note" ? { kind: "note" } : { kind: "under", blockId: ref };
    const say = asActor(host.ctx, actor);
    let r: Extract<QuoteReceipt, { block: unknown }>;
    try { r = await host.ctx.board.quote(ids.map(id => ({ kind: "mark" as const, id })), place, actor, text ? { text } : {}) as typeof r; } catch (err) {
      const why = `couldn't quote: ${err instanceof Error ? err.message : String(err)}`;
      say.flash(why, undefined, errorDetails(err)); host.redraw();
      throw new ActionRefused(why);
    }
    const label = ids.length === 1 ? "quote of a mark" : `quote of ${ids.length} marks`;
    outlineChanged([r.block.id]);
    await this.loadComments(host);
    if (this.session && this.comments) this.session.threads = this.comments;
    this.noteAgent(actor, `quoted ${ids.length === 1 ? "a mark" : `${ids.length} marks`} ${r.placement.said}`);
    host.redraw();
    // Opened to write in (PIE-1184), its undo is the quote's own reader's, recorded after the open so ctrl+z there (once
    // the edit is closed) takes the quote back before the layout's open; else this reader's, as always.
    const opened = open ? await this.writeQuote(r.block.id, host) : null;
    if (r.undo) EXT_UNDO.push({ undo: r.undo, label, by: partyOf(actor), context: opened ? r.block.id : m.id });
    say.flash(`quoted ${r.placement.said}: ${printable(r.block.text.split("\n", 1)[0] ?? "")}${!r.undo ? "" : opened ? " · esc, then ctrl+z there undoes it" : " · ctrl+z undoes"}`);
    return { ...(opened ? { tile: opened } : {}), block: r.block.id, title: r.block.text.split("\n", 1)[0], placed: r.placement.said, parent: r.placement.parentId, marks: r.marks, ...(r.undo ? { undo: r.undo } : {}) };
  }

  /**
   * The person's new quote opened to write in (PIE-1184), as their new notes open (`note.opens`: a float beside what they
   * read, by default), lit as just arrived, the cursor at the end of the quote. The tile's name, or null: the quote is
   * written either way, so nothing here fails it.
   */
  private async writeQuote(id: string, host: SurfaceHost): Promise<string | null> {
    const at = host.writeNew ? await host.ctx.board.get(id).then(note => (note ? host.writeNew!(note) : null)).catch(() => null) : null;
    const d = at?.surface.draft;
    if (!at || !d || d.blockId !== id) return at?.tile ?? null;
    // At the end of the quote, so ⏎ starts the reply under it; nothing is typed for them (closing it changes nothing).
    d.place(d.text.split("\n").length - 1, Infinity);
    return at.tile;
  }


  /**
   * The note line (from 0) of the element at `x`, `y` (cells of the last render), else of the current element, else
   * of the first row read (PIE-1247: what a drag, `element.detach` or `element.quote` takes). Undefined on the header,
   * or with nothing drawn.
   */
  elementLine(x?: number, y?: number): number | undefined {
    const d = this.drawn;
    if (!d) return undefined;
    const row = x !== undefined && y !== undefined ? this.posAt(x, y)?.row
      : (() => { const cur = this.elems.find(e => e.key === this.cur); return cur ? cur.row : d.top + (this.readingRows()?.[0] ?? this.scroll); })();
    if (row === undefined || row < d.top) return undefined;
    const at = d.doc.source[row - d.top];
    return at === undefined || at < 0 ? undefined : d.lines[at];
  }

  /**
   * Where a part dropped at `x`, `y` (cells of the last render) lands in this reader's note (PIE-1357): after the block
   * under it (its last line before a blank one), and the row its drop line is drawn on, just under that block. The
   * person's own edit open here answers in its own lines (`draft`: the drop lands in it); else the note as drawn.
   */
  dropAt(x: number, y: number): { line: number; row: number; draft: boolean } | null {
    const own = this.drafting?.openedBy.kind === "user" ? this.drafting.draft : null;
    if (own) { const at = own.dropAt(x, y); return at && { line: at.line, row: at.row, draft: true }; }
    const d = this.drawn, m = this.msg;
    const pos = d && m ? this.posAt(x, y) : null;
    if (!d || !m || !pos || pos.row < d.top) return null;
    const text = m.text.split("\n"), lineOf = (row: number) => { const at = d.doc.source[row - d.top]; return at === undefined ? undefined : at < 0 ? -1 : d.lines[at]; };
    const blank = (row: number) => { const l = lineOf(row); return l === undefined || (l >= 0 && !(text[l] ?? "").trim()); };
    let row = pos.row, last = lineOf(row);
    if (last === undefined) return null;
    // On a drawn edge (a figure's or callout's border): the block's line is above it.
    for (let up = row - 1; last === -1 && up >= d.top; up--) { const l = lineOf(up); if (l === undefined || (l >= 0 && !(text[l] ?? "").trim())) break; if (l >= 0) last = l; }
    // Down the block under the pointer: its rows, drawn edges (-1) included, to the row before a blank line.
    while (!blank(row) && !blank(row + 1) && row + 1 < d.top + d.body.length) { row++; const l = lineOf(row); if (l !== undefined && l >= 0) last = l; }
    if (last < 0) return null;
    // outline-core's one landing rule (the service's too): never inside a fence or a component, whose closing line
    // isn't drawn; the drop line goes under the block as drawn.
    return { line: landingLine(text, last), row: row - this.scroll + d.heroRows + 1, draft: false };
  }

  /**
   * Materialize a part of this note (PIE-1247, the service's `quote`): the element at note line `line` (or `anchor`),
   * its anchor written when it has none, into `place`: `.detached` (a block of its own that embeds it, no header), or
   * into another note after a line, as a reference or a copy with its query. Attributed; a new block is one undo step.
   */
  async materialize(place: QuotePlace, host: SurfaceHost, actor: Actor, opts: { line?: number; anchor?: string; as?: "reference" | "copy" } = {}): Promise<QuoteReceipt> {
    const m = this.requireNote();
    if (!isOutlineNote(m)) throw new ActionRefused("only a note of the outline has parts to detach or quote");
    // No line named: where the reader is (its current element, else the top row read), the first part from there.
    const here = opts.anchor === undefined && opts.line === undefined;
    const line = opts.anchor ? undefined : opts.line ?? this.elementLine() ?? -1;
    if (line !== undefined && line < 0) throw new ActionRefused("no part of the note is there: move to a figure, a callout, a list item or a paragraph (or name line= or anchor=)");
    // The line was read from the note as drawn. Saved since with only anchors written (the last drop's): the same
    // note, at the newer revision. Any other change is the service's to refuse ("changed since").
    let revision = m.revision!;
    if (line !== undefined) {
      const now = await host.ctx.board.get(m.id).catch(() => null);
      const bare = (t: string) => t.split("\n").map(withoutFragmentAnchor).join("\n");
      if (now && now.revision !== revision && bare(now.text) === bare(m.text)) revision = now.revision!;
    }
    const subject: QuoteSubject = opts.anchor ? { kind: "element", blockId: m.id, anchor: opts.anchor.replace(/^\^/, "") }
      : { kind: "element", blockId: m.id, line: line!, revision, ...(here ? { next: true as const } : {}) };
    const say = asActor(host.ctx, actor);
    let r: QuoteReceipt;
    try { r = await host.ctx.board.quote([subject], place, actor, opts.as ? { as: opts.as } : {}); } catch (err) {
      const why = `couldn't ${place.kind === "detached" ? "detach" : "quote"} it: ${err instanceof Error ? err.message : String(err)}`;
      say.flash(why, undefined, errorDetails(err)); host.redraw();
      throw new ActionRefused(why);
    }
    const part = r.subjects[0]!, what = `${part.label || "the part"}${part.anchored ? ` (^${part.ref.split("^")[1]} added)` : ""}`;
    if ("block" in r) {
      if (r.undo) EXT_UNDO.push({ undo: r.undo, label: place.kind === "detached" ? "detach" : "quote", by: partyOf(actor), context: m.id });
      outlineChanged([r.block.id, m.id]);
      say.flash(`${place.kind === "detached" ? "detached" : "quoted"} ${what}${r.undo ? " · ctrl+z undoes" : ""}`);
      this.noteAgent(actor, `${place.kind === "detached" ? "detached" : "quoted"} ${what}`);
    } else if ("into" in r) {
      outlineChanged([r.into.blockId, m.id]);
      say.flash(`${r.said}: ${what}`);
      this.noteAgent(actor, `${r.said}: ${what}`);
    } else if (part.anchored) outlineChanged([m.id]);
    host.redraw();
    return r;
  }

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
      host.ctx.flash(why, undefined, errorDetails(e)); host.redraw();
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
      const why = `couldn't undo: ${err instanceof Error ? err.message : String(err)}`; host.ctx.flash(why, undefined, errorDetails(err)); host.redraw(); throw new ActionRefused(why);
    }
    history.drop(e);
    outlineChanged([m.id]);
    if (this.msg?.id === m.id) this.refresh({ ...saved, childIds: this.msg.childIds });
    const said = `undid the ${what} change: ${printable(e.edits[0]!.before.trim())}`;
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
    if (ref.live) return this.markLiveRow(ref, ref.live, choice, host, actor);
    const before = ref.step.status, title = stepTitle(ref.step);
    let r: Awaited<ReturnType<SurfaceHost["ctx"]["board"]["changeStep"]>>;
    try {
      r = await this.stepUpdate(ref, choice, host, actor);
    } catch (e) {
      outlineChanged([ref.block]);
      const why = `not changed: ${e instanceof Error ? e.message : String(e)}${e instanceof Refused ? " · the step is read again" : ""}`;
      host.ctx.flash(why, undefined, errorDetails(e));
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
    const where = ref.via ? ` · in ${fullPlainText(ref.via)}` : "";
    let said: string, link: string | undefined;
    if (choice === "copy-link" || choice === "address") {
      link = stepLink(ref.block, r.item.itemId!);
      if (choice === "copy-link" && actor.kind === "user") host.ctx.copy?.(link);
      said = choice === "copy-link" && actor.kind === "user" ? `copied ${link} · "${title}"` : `made "${title}" addressable: ${link}`;
    } else {
      if (r.changed) this.stepHistory.advance(ref.block, (r.block.revision ?? 0) - 1, r.block.revision ?? 0);
      if (r.changed && before !== choice) this.stepHistory.push({ block: ref.block, ...(r.item.itemId ? { itemId: r.item.itemId } : { at: { start: r.item.span.start, revision: r.block.revision ?? 0 } }), evidence: r.item.evidence, status: before, to: choice, title, by: partyOf(actor), context: this.msg?.id ?? ref.block });
      said = r.changed ? `set "${title}" ${statusWord(before)} → ${statusWord(choice)}${where}` : `"${title}" is already ${statusWord(choice)}`;
    }
    // An agent's host says who it is (asActor); the person's says it plainly.
    host.ctx.flash(said);
    this.noteAgent(actor, said);
    host.redraw();
    return { block: ref.block, step: r.item.itemId ?? null, status: r.item.status, from: before, changed: r.changed, revision: r.block.revision ?? null, ...(link ? { link } : {}), recordedAs: mutationFor(actor) };
  }

  /**
   * Give a `::use` the props it needs (PIE-533 S4): the person is asked for each in the power bar, in the picker of its kind
   * (a choice's options, a note found by its words), and the answers are written onto the call's line through the note's
   * ordinary save (rewriteLines), recorded as whoever asks; ctrl+z (use.undo) puts the line back. An agent names the props
   * (`with`); nothing here is asked of it or moves the person's focus.
   */
  async fillUse(block: string | undefined, line: number | undefined, given: Record<string, string>, host: SurfaceHost, actor: Actor) {
    // The note the call is written in: the one shown, or one drawn inside it (an embed, a template that holds a call).
    const shown = this.requireNote();
    const whole = block && block !== shown.id ? await host.ctx.board.get(block) : await this.whole();
    if (!whole) throw new ActionRefused(`that note (${block}) isn't there any more`);
    const calls = useCallsOf(whole.text);
    const call = line === undefined ? (calls.length === 1 ? calls[0] : undefined) : calls.find(c => c.line === line - 1);
    if (!call) throw new ActionRefused(calls.length ? `say which ::use: line= (${calls.map(c => c.line + 1).join(", ")})` : "this note has no ::use line");
    let answer: Awaited<ReturnType<SurfaceHost["ctx"]["board"]["templateUse"]>>;
    try { answer = await host.ctx.board.templateUse(whole.id, call.line); }
    catch (e) { throw new ActionRefused(`couldn't read the ::use on line ${call.line + 1}: ${e instanceof Error ? e.message : String(e)}`); }
    const need = answer.missing.filter(x => given[x.name] === undefined);
    const write = (answers: Record<string, string>) => this.inTurn(async () => {
      const props = Object.fromEntries(Object.entries({ ...given, ...answers }).filter(([, v]) => v !== ""));
      if (!Object.keys(props).length) throw new ActionRefused("nothing to write: no prop was given");
      const before = whole.text.split("\n")[call.line] ?? "", after = withUseProps(before, props);
      if (after === null) throw new ActionRefused(`those values can't be written on line ${call.line + 1}: a ::use line holds a value on one line, without { or } (outside a {{ }}); write it by hand, or give another value`);
      if (after === before) throw new ActionRefused(`line ${call.line + 1} already says that`);
      const r = await this.rewriteLines(whole.id, [{ line: call.line, before, after }], this.useHistory, host, actor, USE_STALE);
      const said = `${answer.template?.title ?? "::use"}: wrote ${Object.entries(props).map(([k, v]) => `${k}=${v}`).join(" ")}`;
      host.ctx.flash(`${said}${actor.kind === "user" ? " · ctrl+z takes it back" : ""}`);
      this.noteAgent(actor, said);
      host.redraw();
      return { block: whole.id, line: call.line + 1, wrote: props, stillMissing: need.filter(x => props[x.name] === undefined).map(x => x.name), revision: r.revision ?? null, recordedAs: mutationFor(actor) };
    });
    if (!need.length && !Object.keys(given).length) return { block: whole.id, line: call.line + 1, missing: [], said: "this ::use needs nothing more" };
    if (actor.kind !== "user" || !need.length) {
      if (actor.kind !== "user" && need.length && !Object.keys(given).length) {
        throw new ActionRefused(`the ::use on line ${call.line + 1} needs ${need.map(x => x.name).join(", ")}: use.fill line=${call.line + 1} with='{${need.map(x => `"${x.name}":"${x.example.replace(/^[^=]+=/, "")}"`).join(",")}}'`);
      }
      return write({});
    }
    return askInBar(host.ctx as never, `${answer.template?.title ?? "::use"} needs`, need.map(x => propQuestion(x.name, answer.spec[x.name]!)), given, actor, write);
  }

  splitAttachment(target: "comment" | "sources" | "list-preview" | "edit-preview", direction: string | undefined, share: number | undefined, host: SurfaceHost) {
    if (direction !== undefined && direction !== "right" && direction !== "down") throw new ActionRefused("split direction is right or down");
    const split = this.splits[target];
    if (direction) split.direction = direction;
    if (share !== undefined) split.share = Math.max(.15, Math.min(.85, share));
    if (target === "edit-preview") writeState("edit-preview-place.json", { place: this.editPreview.place, split });
    host.redraw(); return { ...split };
  }

  async gripSources(host: SurfaceHost) {
    const sm = this.sourcesMode;
    if (!sm) throw new ActionRefused("S opens the Sources inspector");
    if (sm.place !== "floating" && sm.place !== "tile") await this.placeSources("floating", undefined, host);
    this.modes.push(this.gripMode(sm, "sources")); host.redraw();
    return { moving: true };
  }

  moveSources(a: ComposerMove, host: SurfaceHost) {
    const sm = this.sourcesMode;
    if (!sm || sm.place !== "floating" || !sm.frame) throw new ActionRefused("sources.place place=floating floats the panel first");
    sm.float = a.reset ? null : moveFloat(sm.float ?? sm.frame, a, sm.room);
    host.redraw(); return sm.float;
  }

  floatAt(x: number, y: number, host?: SurfaceHost): "comment" | "sources" | "draft" | null {
    if (host?.attachment) return null;
    const sm = this.sourcesMode, cs = this.session;
    const comment = { target: "comment" as const, rect: cs && (cs.place === "floating" || cs.place === "popup") && this.boxRect ? { ...this.boxRect, row: this.boxRect.row + (this.drawn?.heroRows ?? 0) } : null };
    const sources = { target: "sources" as const, rect: sm && (sm.place === "floating" || sm.place === "popup") ? sm.frame : null };
    const preview = { target: "draft" as const, rect: this.draft?.preview ? this.editPreview.frame : null };
    return attachedAt(sm && this.modes.active(sm) ? [preview, comment, sources] : [preview, sources, comment], x, y);
  }

  private renderSources(cols: number, rows: number, row: number, col: number): SurfaceView {
    const sm = this.sourcesMode!;
    sm.rect = { x: col, y: row, w: cols, h: rows };
    const chip = `[${sm.place} ▸]`;
    const footer = rowLines(this.modes.active(sm) ? "sources has keys" : "reader has keys · click panel to enter", cols);
    const room = Math.max(1, rows - footer.length - 1);
    sm.footer = room + 1;
    const full = drawSources(sm.panel, cols, Date.now());
    sm.view.lines = full.lines;
    const top = sm.view.place(full.focus, full.lines.length, room);
    const left = Math.max(0, cols - chip.length);
    sm.draw = { ...full, lines: full.lines.slice(top, top + room).map((l, i) => sm.view.paint(l, top + i)), hits: [
      { row: 0, from: left, to: cols, action: "placement.menu", args: { target: "sources" } },
      ...full.hits.map(x => ({ ...x, row: x.row - top + 1 })).filter(x => x.row > 0 && x.row <= room),
    ] };
    const lines = [pad("Sources", left) + fg(C.lcyan) + chip + RESET, ...sm.draw.lines];
    while (lines.length < room + 1) lines.push("");
    lines.push(...footer);
    return { lines };
  }

  attachmentHint(target: "comment" | "sources" | "list-preview" | "edit-preview"): string {
    if (target === "edit-preview") return modeHint(EDIT_PREVIEW_KEYS, action => NOTE_ACTIONS.def(action));
    return (target === "comment" ? this.modes.get("comment") : this.modes.get(target))?.hint() ?? "";
  }

  attachedKeys(target: "comment" | "sources" | "list-preview" | "edit-preview") {
    const sm = this.sourcesMode;
    if (sm) this.modes.focus(sm, target === "sources");
  }

  sourcesTile(w: number, h: number): SurfaceView | null {
    if (this.sourcesMode?.place !== "tile") return null;
    const r = attachedRect("tile", w, h);
    return this.withPlacementMenu(this.renderSources(r.cols, r.rows, r.row, r.col), w, h, "sources");
  }

  async placeSources(place: string | undefined, side: string | undefined, host: SurfaceHost) {
    const sm = this.sourcesMode;
    if (!sm) throw new ActionRefused("S opens the Sources inspector");
    const want = place === undefined ? side ? "tile" : nextPlace(sm.place, !!host.sourcesTile) : attachedPlaceOf(place);
    if (!want) throw new ActionRefused(`place is ${ATTACHED_PLACES.join(", ")}`);
    if (side !== undefined && !["left", "right", "up", "down"].includes(side)) throw new ActionRefused("side is left, right, up or down");
    if (want === "tile" && !host.sourcesTile) throw new ActionRefused("this reader has no tiles · sources.place place=split shares the reader");
    if (want === "split" && side) this.splitAttachment("sources", side, undefined, host);
    await this.placeAttachment("sources", want, host, side as AttachedSide | undefined);
    sm.reveal = true;
    writeState("sources-place.json", { place: want });
    host.redraw();
    return { place: want };
  }

  async placeListPreview(place: string | undefined, host: SurfaceHost, side?: AttachedSide) {
    const want = attachedPlaceOf(place ?? (side ? "tile" : nextPlace(this.listPreview.place, !!host.listPreviewTile)));
    if (!want) throw new ActionRefused(`place is ${ATTACHED_PLACES.join(", ")}`);
    if (want === "tile" && !host.listPreviewTile) throw new ActionRefused("this reader has no tiles; use split");
    await this.placeAttachment("list-preview", want, host, side);
    writeState("list-preview-place.json", { place: want });
    host.redraw(); return { place: want };
  }

  private menuOffset = { col: 0, row: 0 };
  private menuArea = { row: 0, col: 0, rows: 0, cols: 0 };
  private get placementMenu() { return this.modes.get("placement") as (ReaderMode<SurfaceHost> & { list: ListPicker<AttachedPlace, SurfaceHost>; target: "comment" | "sources" | "list-preview" | "edit-preview" }) | null; }

  openPlacementMenu(target: "comment" | "sources" | "list-preview" | "edit-preview", host: SurfaceHost) {
    if (target === "list-preview" && host.hasWiredPreview?.()) throw new ActionRefused("the select wire places these children in its preview tile · tile.move moves that tile");
    const place = target === "edit-preview" ? (this.draft?.preview ? this.editPreview.place : null) : target === "list-preview" ? this.listPreview.place : target === "comment" ? this.session?.place : this.sourcesMode?.place;
    if (!place) throw new ActionRefused(`open ${target} first`);
    const control = this.session?.composer?.frame?.controls.find(c => c.action === "place");
    if (target === "comment" && !control) throw new ActionRefused("write a comment in a reader at least 28 columns wide to show its placement chip");
    const sm = this.sourcesMode;
    const chip = target === "comment"
      ? { col: control!.from, row: control!.row + (place === "tile" ? 0 : this.drawn?.heroRows ?? 0) }
      : target === "edit-preview" ? { col: this.editPreview.rect!.col + this.editPreview.rect!.cols - `[${place} ▸]`.length, row: this.editPreview.rect!.row }
      : target === "list-preview" ? { col: this.listPreview.rect!.col + this.listPreview.rect!.cols - `[${place} ▸]`.length, row: this.listPreview.rect!.row }
      : { col: sm!.rect.x + sm!.rect.w - `[${place} ▸]`.length, row: sm!.rect.y };
    const list = new ListPicker<AttachedPlace, SurfaceHost>({
      name: "placement", items: () => ATTACHED_PLACES.filter(p => p !== "tile" || !!(target === "edit-preview" ? host.editPreviewTile : target === "list-preview" ? host.listPreviewTile : target === "comment" ? host.composerTile : host.sourcesTile)),
      row: (p, _i, on, w) => [menuRow({ label: p }, p === place ? "current" : on, w)], clickChooses: true, wraps: true,
      choose: p => { void this.runKey("placement.choose", { place: p }, host); },
      closed: () => { void this.runKey("placement.close", {}, host); },
      clicked: (x, y) => {
        if (y !== this.menuArea.row - this.menuOffset.row + this.menuArea.rows - 2) return false;
        const local = x - (this.menuArea.col - this.menuOffset.col) - 1;
        if (local >= 0 && local < 15) { void this.runKey("placement.choose", { place: "split", direction: local < 8 ? "right" : "down" }, host); return true; }
        return false;
      },
      frame: area => {
        const cols = Math.min(22, area.cols), rows = Math.min(10, area.rows);
        const col = Math.max(0, Math.min(chip.col - this.menuOffset.col, area.cols - cols));
        const y = chip.row - this.menuOffset.row;
        const row = Math.max(0, Math.min(y + 1 + rows <= area.rows ? y + 1 : y - rows, area.rows - rows));
        return { tail: ["[beside] [below]"], rect: { col, row, cols, rows }, title: "Placement" };
      },
    });
    list.sel = list.items.indexOf(place);
    this.modes.push({ name: "placement", of: list, word: "placement", noun: "the placement menu", list, target,
      holdsKeys: true, editing: () => false, covers: () => false,
      key: k => {
        if (k.kind === "esc") void this.runKey("placement.close", {}, host);
        else if (k.kind === "enter") void this.runKey("placement.choose", {}, host);
        else if (k.kind === "left" || k.kind === "right") void this.runKey("placement.choose", { place: "split", direction: k.kind === "right" ? "right" : "down" }, host);
        else if (isUp(k) || isDown(k) || k.kind === "tab") void this.runKey("placement.step", { by: isUp(k) ? -1 : 1 }, host);
        return true;
      },
      click: (x, y) => { list.key({ kind: "mouse", action: "down", button: 0, x: x - this.menuOffset.col, y: y - this.menuOffset.row }, host); host.redraw(); return true; },
      rows: () => null, leave: async () => { this.modes.drop("placement"); return { left: "nothing" }; },
      hint: () => "placement · arrows select · Enter choose · Esc close", state: () => "placement", describe: () => ({ target, current: place }),
    });
    host.redraw();
    return { target, current: place };
  }

  stepPlacement(by: number, host: SurfaceHost) {
    const m = this.placementMenu;
    if (!m) throw new ActionRefused("click the placement chip first");
    m.list.sel = (m.list.sel + by + m.list.items.length) % m.list.items.length;
    host.redraw(); return { selected: m.list.items[m.list.sel] };
  }

  closePlacement(host: SurfaceHost) { this.modes.drop("placement"); host.redraw(); return { closed: true }; }

  async choosePlacement(place: string | undefined, host: SurfaceHost, direction?: string): Promise<unknown> {
    const m = this.placementMenu;
    if (!m) throw new ActionRefused("click the placement chip first");
    const chosen = place ?? m.list.items[m.list.sel]!;
    if (direction) this.splitAttachment(m.target, direction, undefined, host);
    this.closePlacement(host);
    return m.target === "edit-preview" ? this.placeEditPreview(chosen, host) : m.target === "list-preview" ? this.placeListPreview(chosen, host) : m.target === "sources" ? this.placeSources(chosen, undefined, host) : this.runKey("comment.place", { place: chosen }, host);
  }

  private withPlacementMenu(view: SurfaceView, w: number, h: number, where: "reader" | "comment" | "sources" | "list-preview" | "edit-preview"): SurfaceView {
    const m = this.placementMenu;
    if (!m) return view;
    const place = m.target === "edit-preview" ? this.editPreview.place : m.target === "list-preview" ? this.listPreview.place : m.target === "comment" ? this.session?.place : this.sourcesMode?.place;
    if ((place === "tile" ? m.target : "reader") !== where) return view;
    const frame = view.frame ?? { col: 0, row: 0, cols: w, rows: h };
    this.menuOffset = frame;
    const canvas = new Canvas(frame.cols, frame.rows);
    view.lines.forEach((l, y) => canvas.text(0, y, l, frame.cols));
    const area = { col: 0, row: 0, cols: frame.cols, rows: frame.rows };
    const rect = m.list.spec.frame!(area, m.list.items.length).rect;
    this.menuArea = { ...rect, col: rect.col + frame.col, row: rect.row + frame.row };
    m.list.draw(canvas, area);
    return { ...view, lines: canvas.lines(), placements: [] };
  }

  // ── Sources (PIE-956 S6b) ────────────────────────────────────────────────────────────────────────────────────────

  /** The Sources inspector, when it is open on this reader. */
  get sourcesMode(): SourcesMode | null { return (this.modes.get("sources") as SourcesMode | null) ?? null; }
  readonly sourceHistory = new UndoHistory<LineUndo>();

  /** Whether the note has anything generated: what the header's `[sources]` chip is for. */
  private hasSources(m: Msg): boolean {
    if (!isOutlineNote(m) || m.partial) return false;
    return sourceCalls(m.text).length > 0 || projectionsOf(m, this.src).some(p => p.kind === "output" || p.kind === "component");
  }

  /** The source answer as an agent reads it, one row per source. */
  private sourcesRead(a: NonNullable<SourcesPanel["answer"]>) {
    return { block: a.blockId, revision: a.revision, readAt: a.readAt, sources: a.sources.map((s, i) => ({ n: i + 1, key: s.key, kind: s.kind, name: s.name, line: s.line + 1, ...(s.readAt ? { readAt: s.readAt } : {}), live: s.live, params: s.query.params, editable: s.query.editable, transform: s.transform.label, ...(s.transform.block ? { transformBlock: s.transform.block } : {}), rows: s.result.rows, ...(s.problem ? { problem: s.problem } : {}) })) };
  }

  /** Read the service's answer for the panel again (`site.sources`); a failed read is said in the panel, never thrown. */
  private async readSources(P: SourcesPanel, host: SurfaceHost) {
    P.loading = true;
    try {
      const was = P.answer?.sources[P.open ?? -1]?.key;
      P.answer = await host.ctx.board.siteSources(P.block);
      const { schemas } = await host.ctx.board.componentSchemas();
      for (const source of P.answer.sources) if (source.kind === "figure") {
        const props = schemas.find(x => x.id === source.name)?.props.filter(x => x.where === "yaml") ?? [];
        for (const p of props) if (!source.query.params.some(x => x.key === p.key)) source.query.params.push({ key: p.key, value: p.default ?? "" });
      }
      P.error = null;
      if (was !== undefined) { const i = P.answer.sources.findIndex(s => s.key === was); P.open = i < 0 ? null : i; }
      P.sel = Math.min(P.sel, Math.max(0, P.answer.sources.length - 1));
    } catch (e) { P.error = `couldn't read what this note generates: ${e instanceof Error ? e.message : String(e)}`; }
    P.loading = false;
    host.redraw();
  }

  /**
   * Open the Sources inspector on this note (`sources.open`, `sources.at`, the header's `[sources]`, `S`): every generated
   * region with when it last read, and, at `line` (a note line, from 0), that region's three folds. The person's; an
   * agent's call answers the same list and opens nothing in their reader.
   */
  async openSources(host: SurfaceHost, actor: Actor, standing: boolean, at?: { line: number } | { anchor: string }) {
    const m = this.requireNote();
    if (!isOutlineNote(m)) throw new ActionRefused("a resource or a file isn't a block: it generates nothing here");
    if (!standing) {
      const a = await host.ctx.board.siteSources(m.id);
      const i = this.sourceIndex(a, at);
      if (at !== undefined && i < 0) throw new ActionRefused(`no generated region holds ${"line" in at ? `line ${at.line + 1}` : `^${at.anchor}`}: ${a.sources.map(s => `${s.name} (line ${s.line + 1})`).join(", ") || "this note has none"}`);
      this.noteAgent(actor, `read the sources of this note`);
      return { ...this.sourcesRead(a), ...(i >= 0 ? { at: i + 1 } : {}), opened: false };
    }
    let mode = this.sourcesMode;
    if (!mode || mode.panel.block !== m.id) { mode = this.sourcesModeOf(newPanel(m.id, ""), host); this.modes.push(mode); }
    mode.reveal = true;
    this.focusSources(host, true);
    const P = mode.panel;
    await this.readSources(P, host);
    if (at !== undefined && P.answer) {
      const i = this.sourceIndex(P.answer, at);
      if (i < 0) { host.ctx.flash(`no generated region holds that line`); }
      else { if (mode.view.field) await mode.view.input("cancel"); P.open = i; P.sel = i; P.item = 0; mode.view.reset(); }
    }
    host.redraw();
    return { opened: true, ...(P.answer ? this.sourcesRead(P.answer) : { block: m.id, sources: [] }), ...(P.open !== null ? { at: P.open + 1 } : {}) };
  }

  /**
   * The generated region the person's selection or `[ ]` position is in, as the note line (from 0) it is written on, or
   * its anchor (`#out-…`), for `sources.at`: the region's own key says it, so rows a region draws never read as the line
   * they were drawn after.
   */
  regionHere(): { line: number } | { anchor: string } | null {
    const sel = this.selection, e = sel ? null : this.inView();
    const from = sel ? Math.min(sel.anchor.row, sel.head.row) : e?.row, to = sel ? Math.max(sel.anchor.row, sel.head.row) : e?.row;
    if (from === undefined || to === undefined) return null;
    const hit = this.regionSpans.find(r => from < r.to && to >= r.from);
    if (!hit) return null;
    const tail = /:(#.+|\d+)$/.exec(hit.key)?.[1];
    if (!tail) return null;
    return tail.startsWith("#") ? { anchor: tail.slice(1) } : { line: Number(tail) };
  }

  /** Which source a line or an anchor names, or -1. */
  private sourceIndex(a: NonNullable<SourcesPanel["answer"]>, at: { line: number } | { anchor: string } | undefined): number {
    if (!at) return -1;
    return "line" in at ? sourceAt(a, at.line) : a.sources.findIndex(s => s.key === `#${at.anchor}`);
  }

  /** Whether the selection (or `[ ]` position) lies in a generated region: the passage toolbar's "Where from". */
  private selectionInRegion(): boolean {
    const sel = this.selection;
    if (!sel) return false;
    const a = Math.min(sel.anchor.row, sel.head.row), b = Math.max(sel.anchor.row, sel.head.row);
    return this.regionSpans.some(r => a < r.to && b >= r.from);
  }

  /** What the panel's focused row (or the open source) does on ⏎ or a click. */
  async enterSource(host: SurfaceHost, actor: Actor, n?: number, fresh = false): Promise<unknown> {
    const P = this.requireSources(), a = P.answer;
    if (!a) throw new ActionRefused("the sources are still being read");
    if (P.open === null) {
      const i = n !== undefined ? n - 1 : P.sel;
      if (!a.sources[i]) throw new ActionRefused(`this note has ${a.sources.length} generated region${a.sources.length === 1 ? "" : "s"}`);
      P.open = i; P.sel = i; P.item = 0; P.note = "";
      host.redraw();
      return { open: i + 1, source: a.sources[i]!.name };
    }
    const s = a.sources[P.open]!, items = itemsOf(s, P.folds), at = n !== undefined ? n - 1 : P.item;
    const it = items[at];
    if (!it) throw new ActionRefused(`this source has ${items.length} rows`);
    P.item = at; P.note = "";
    if (it.kind === "fold") return this.foldSource(it.fold, host);
    if (it.kind === "param") return this.setSourceParam(undefined, it.key, undefined, host, actor);
    if (it.kind === "jump") return this.jumpSource(host, actor);
    if (it.kind === "download") return this.downloadSource(it.format, host);
    if (it.kind === "result") {
      if (!it.block) return this.copySource("result", host, actor);
      await this.followTarget({ block: it.block, role: "embed" }, host, { link: true, fresh });
      return { opened: it.block, fresh };
    }
    return this.copySource(it.part, host, actor);
  }

  /** Scroll the inspector's rows by `by` (a tall result or transform is read by scrolling; moving the focus scrolls it into view). */
  scrollSources(host: SurfaceHost, by: number) {
    const mode = this.sourcesMode;
    if (!mode) throw new ActionRefused("the Sources inspector isn't open here · S opens it");
    mode.view.scroll(by);
    host.redraw();
    return { top: mode.view.top };
  }

  private requireSources(): SourcesPanel {
    const m = this.sourcesMode;
    if (!m) throw new ActionRefused("the Sources inspector isn't open here · S opens it, or the header's [sources], or select words in a generated region and press a then w");
    return m.panel;
  }

  async foldSource(fold: SourcesFold, host: SurfaceHost) {
    const P = this.requireSources();
    if (fold === "query" && this.sourcesMode?.view.field) await this.sourcesMode.view.input("cancel");
    P.folds[fold] = !P.folds[fold];
    const s = P.answer?.sources[P.open ?? -1];
    if (s) P.item = Math.min(P.item, itemsOf(s, P.folds).length - 1);
    host.redraw();
    return { fold, open: P.folds[fold] };
  }

  async pickSource(host: SurfaceHost, by?: number, n?: number) {
    if (this.sourcesMode?.view.field) await this.sourcesMode.view.input("cancel");
    const P = this.requireSources(), a = P.answer;
    if (!a) return { selected: 0 };
    if (P.open === null) {
      const last = Math.max(0, a.sources.length - 1);
      P.sel = n !== undefined ? Math.max(0, Math.min(last, n - 1)) : Math.max(0, Math.min(last, P.sel + (by ?? 1)));
      host.redraw();
      return { selected: P.sel + 1 };
    }
    const items = itemsOf(a.sources[P.open]!, P.folds);
    P.item = n !== undefined ? Math.max(0, Math.min(items.length - 1, n - 1)) : Math.max(0, Math.min(items.length - 1, P.item + (by ?? 1)));
    host.redraw();
    return { item: P.item + 1, of: items.length };
  }

  closeSources(host: SurfaceHost) {
    if (this.sourcesMode?.view.field) throw new ActionRefused("finish the property field · Enter saves · Esc cancels");
    const sm = this.sourcesMode;
    if (this.modes.get("grip")?.of === sm) this.modes.drop("grip");
    this.modes.drop("sources");
    if (this.placementMenu?.target === "sources") this.modes.drop("placement");
    if (this.frameDrag?.target === "sources") this.frameDrag = null;
    void this.attachmentTiles.sources.close(this.attachmentTileHost("sources", host));
    host.redraw();
    return { closed: true };
  }

  focusSources(host: SurfaceHost, on: boolean) {
    const mode = this.sourcesMode;
    if (!mode) throw new ActionRefused("S opens the Sources inspector");
    this.modes.focus(mode, on);
    if (on) host.enterMode?.();
    host.redraw();
    return { keys: on ? "sources" : "reader" };
  }

  /** Back from one source to the list; from the list, close. */
  async backSource(host: SurfaceHost) {
    if (this.sourcesMode?.view.field) await this.sourcesMode.view.input("cancel");
    const P = this.sourcesMode?.panel;
    if (P && P.open !== null) { P.open = null; P.note = ""; host.redraw(); return { closed: false, view: "list" }; }
    return this.closeSources(host);
  }

  /** Re-read the sources; with `all` (the list's ⟳) run every line that runs again first, as the person asks. */
  async refreshSources(host: SurfaceHost, actor: Actor, all: boolean) {
    const P = this.requireSources();
    const s = P.answer?.sources[P.open ?? -1];
    if (all || !s) {
      try { await host.ctx.board.refreshProjections(P.block, undefined, actor); } catch (e) { host.ctx.flash(`not all ran: ${e instanceof Error ? e.message : String(e)}`, undefined, errorDetails(e)); }
      resourceChanged(null);
    } else if (s.kind === "handler" || s.kind === "expr") {
      try { await host.ctx.board.refreshProjections(P.block, s.line, actor); } catch (e) { host.ctx.flash(`not run: ${e instanceof Error ? e.message : String(e)}`, undefined, errorDetails(e)); }
      resourceChanged(null);
    }
    await this.readSources(P, host);
    return { readAt: P.answer?.readAt ?? null, sources: P.answer?.sources.length ?? 0 };
  }

  /** The text a part of the open source copies: its query line, its code, or every row of its result. */
  private sourcePart(s: SourceEntry, part: "query" | "transform" | "result"): string {
    if (part === "query") return s.query.text;
    if (part === "transform") return s.transform.text ?? "";
    return s.result.table && s.result.columns && s.result.table.length >= s.result.rows ? [s.result.columns.join("\t"), ...s.result.table.map(r => r.join("\t"))].join("\n") : s.result.text;
  }

  async copySource(part: "query" | "transform" | "result", host: SurfaceHost, actor: Actor, source?: string, selected = false) {
    const { s } = await this.sourceFor(host, source);
    const text = selected && actor.kind === "user" && this.sourcesMode?.view.text() || this.sourcePart(s, part);
    if (actor.kind === "user") { host.ctx.copy?.(text); host.ctx.flash(`copied ${s.name}'s ${part}`); }
    host.redraw();
    return { part, text, ...(actor.kind === "user" ? { copied: true } : {}) };
  }

  async downloadSource(format: "csv" | "json", host: SurfaceHost, source?: string, path?: string) {
    const { s } = await this.sourceFor(host, source);
    const destination = path ?? join(outlineState(), "downloads", `${s.name.replace(/[^a-zA-Z0-9_-]/g, "-")}-${crypto.randomUUID()}.${format}`);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, sourceDownload(s.result, format), { mode: 0o600, flag: "wx" });
    host.ctx.flash(`saved ${s.name}: ${destination}`);
    host.redraw();
    return { path: destination, format, rows: s.result.rows };
  }

  /** The transform's note, opened in this reader (the person's; an agent reads it with outline_read). */
  async jumpSource(host: SurfaceHost, actor: Actor, standing = standsAsPerson(actor, host.ctx.person?.() ?? NOBODY, "tile")) {
    const P = this.requireSources(), s = P.answer?.sources[P.open ?? -1];
    if (!s) throw new ActionRefused("open a source first");
    if (!s.transform.block) {
      if (!standing) return { block: P.block, line: s.line + 1, opened: false };
      this.focusSources(host, false);
      const text = this.requireNote().text;
      await this.revealAt(text.split("\n").slice(0, s.line).join("\n").length + (s.line ? 1 : 0), host, actor);
      return { block: P.block, line: s.line + 1, opened: true };
    }
    if (!standing) return { block: s.transform.block, opened: false, said: "an agent reads it with outline_read; the jump opens it in the person's reader" };
    this.modes.drop("sources");
    await this.followTarget({ block: s.transform.block, role: "embed" }, host, { link: true, by: actor, standing });
    return { opened: s.transform.block };
  }

  /**
   * The source an action names: `which` (its number in the list from 1, or its key), else the one the person has open. An
   * agent needs no inspector: the answer is read from the service, so its call never touches the person's reader.
   */
  private async sourceFor(host: SurfaceHost, which: string | undefined): Promise<{ s: SourceEntry; P: SourcesPanel | null; block: string; revision: number }> {
    const m = this.requireNote(), P = this.sourcesMode?.panel.block === m.id ? this.sourcesMode.panel : null;
    const a = (which !== undefined || !P?.answer) ? (P?.answer ?? await host.ctx.board.siteSources(m.id)) : P.answer;
    const s = which !== undefined ? (/^\d+$/.test(which) ? a.sources[Number(which) - 1] : a.sources.find(x => x.key === which)) : a.sources[P?.open ?? -1];
    if (!s) throw new ActionRefused(which !== undefined ? `no source ${which}: this note's are ${a.sources.map((x, i) => `${i + 1} ${x.name}`).join(", ") || "none"}` : "open one source first (⏎ on it), or name it: source=<its number in sources.open's list>");
    return { s, P, block: m.id, revision: a.revision };
  }

  /**
   * Write one parameter of a source back onto the note's line (`sources.set`): a handler line's slot or a `::use`'s prop,
   * through the note's save, checked against the line as the source was read, recorded as whoever asks; ctrl+z takes it back.
   * The person is asked for the value; an agent passes it (and names the source). Other kinds are written in the note.
   */
  async setSourceParam(source: string | undefined, param: string | undefined, value: string | undefined, host: SurfaceHost, actor: Actor): Promise<unknown> {
    const { s, P, block, revision } = await this.sourceFor(host, source);
    if (s.kind === "figure") return this.setFigureParam(s, P, block, revision, param, value, host, actor);
    if (!s.query.editable) throw new ActionRefused(`${s.name} is written in the note, not through a field: edit its line ${s.line + 1} there`);
    const cur = P && P.answer?.sources[P.open ?? -1] === s ? itemsOf(s, P.folds)[P.item] : undefined;
    const key = param ?? (cur?.kind === "param" ? cur.key : undefined);
    const now = s.query.params.find(x => x.key === key);
    if (!key) throw new ActionRefused(`say which parameter: param=<${s.query.params.map(x => x.key).join("|") || "name"}>`);
    // A button's slot has one writer, button.slot: its checks (a slot of the button), its asking (a tile by the picker) and its
    // keeping (a tile by identity).
    if (s.kind === "button") return this.setButtonSlot({ note: block, line: s.line + 1, key, ...(value !== undefined ? { value } : {}) }, host, actor);
    const write = (given: string) => this.inTurn(async () => {
      // The line as the source was read: a line another client changed since is refused, never rewritten as if it were this one.
      const before = s.query.text;
      const after = s.kind === "use" ? withUseProps(before, { [key]: given }) : s.kind === "handler" ? withSlotProps(before, { [key]: given }) : null;
      if (after === null) throw new ActionRefused(`that value can't be written on line ${s.line + 1}: it holds one line, and none of { }`);
      if (after === before) throw new ActionRefused(`line ${s.line + 1} already says that`);
      const r = await this.rewriteLines(block, [{ line: s.line, before, after }], this.sourceHistory, host, actor, SOURCE_STALE);
      const said = `${s.name}: ${key}=${given}`;
      host.ctx.flash(`${said}${actor.kind === "user" ? " · ctrl+z takes it back" : ""}`);
      this.noteAgent(actor, said);
      if (P) await this.readSources(P, host);
      return { block, line: s.line + 1, wrote: { [key]: given }, revision: r.revision ?? null, recordedAs: mutationFor(actor) };
    });
    if (value !== undefined) return write(value);
    if (actor.kind !== "user") throw new ActionRefused(`give the new value: sources.set source=${source ?? "<n>"} param=${key} value=<text>`);
    return askInBar(host.ctx as never, `${s.name}: ${key}`, [{ name: "value", type: "text", label: key, ...(now ? { value: now.value } : {}) }], {}, actor, answers => write(answers.value ?? ""));
  }

  private async setFigureParam(s: SourceEntry, P: SourcesPanel | null, block: string, revision: number, param: string | undefined, value: string | undefined, host: SurfaceHost, actor: Actor) {
    const cur = P && itemsOf(s, P.folds)[P.item];
    const key = param ?? (cur?.kind === "param" ? cur.key : undefined);
    const { schemas } = await host.ctx.board.componentSchemas();
    const prop = schemas.find(x => x.id === s.name)?.props.find(p => p.where === "yaml" && p.key === key);
    if (!prop) throw new ActionRefused(`choose a property of ${s.name} in Query`);
    const current = s.query.params.find(p => p.key === key)?.value ?? prop.default ?? "";
    const write = (given: string) => this.inTurn(async () => {
      const m = await host.ctx.board.get(block);
      if (!m) throw new ActionRefused("the figure note was removed · text kept");
      if (m.revision !== revision) throw new ActionRefused("the figure changed since this field opened · text kept · Esc then e reads it again");
      const lines = m.text.split("\n"), observed = lines.slice(s.line, s.endLine + 1).join("\n");
      const body = withFigureProp(lines.slice(s.line + 1, s.endLine), prop.key, prop.type === "list" ? given || "[]" : JSON.stringify(given));
      const replacement = [lines[s.line]!, ...body, lines[s.endLine]!].join("\n");
      const start = lines.slice(0, s.line).join("\n").length + (s.line ? 1 : 0);
      await this.patchSource(block, revision, observed, replacement, start, host, actor);
      this.sourceHistory.push({ block, edits: [{ line: s.line, before: observed, after: replacement }], patch: { start }, by: partyOf(actor), context: block });
      let warning = schemaCheck(prop, given);
      if (prop.type === "query") {
        try { await host.ctx.board.request("query.matches", { expression: given, blockIds: [block] }); }
        catch (e) { warning = e instanceof Error ? e.message : String(e); }
      }
      if (P) { await this.readSources(P, host); if (warning) P.warnings[prop.key] = warning; else delete P.warnings[prop.key]; P.note = warning ? `saved · ${warning}` : `saved ${prop.key} · ctrl+z undoes`; }
      this.noteAgent(actor, `set ${s.name} ${prop.key}=${given}`);
      host.ctx.flash(warning ? `saved · ${warning}` : `saved ${prop.key} · ctrl+z undoes`);
      host.redraw();
      return { block, wrote: { [prop.key]: given }, recordedAs: mutationFor(actor), ...(warning ? { warning } : {}) };
    });
    if (value !== undefined) return write(value);
    if (actor.kind !== "user") throw new ActionRefused(`give value= for ${prop.key}`);
    const view = this.sourcesMode!.view;
    let choices = prop.values?.map(v => v.value) ?? [];
    if (prop.key === "group") choices = s.result.propertyNames ?? [];
    if (prop.key === "columns") choices = [...new Set([...(s.result.columns ?? []), ...(s.result.propertyNames ?? []), ...(Bun.YAML.parse(current || "[]") as string[])])];
    await view.edit(prop.key, prop.type === "list" ? JSON.stringify(Bun.YAML.parse(current || "[]")) : current, choices, prop.type === "list" && choices.length > 0, `figure:${block}:${s.line}:${prop.key}`, write, { redraw: () => host.redraw(), said: text => host.ctx.flash(text) });
    const index = itemsOf(s, P!.folds).findIndex(x => x.kind === "param" && x.key === prop.key);
    if (index >= 0) P!.item = index;
    this.focusSources(host, true);
    host.redraw();
    return { editing: prop.key, choices };
  }

  private async patchSource(block: string, revision: number, observed: string, replacement: string, start: number, host: SurfaceHost, actor: Actor) {
    const result = await host.ctx.board.request<{ outcome: string; reason?: string }>("draft.patch", {
      blockId: block, revision, patches: [{ observed, replacement, range: { start, end: start + observed.length } }], mutation: mutationFor(actor),
    });
    if (result.outcome !== "applied") throw new ActionRefused(`text kept as a proposal · ${result.reason}`);
    const saved = await host.ctx.board.get(block);
    if (saved && this.msg?.id === block) this.refresh({ ...saved, childIds: this.msg.childIds });
    outlineChanged([block]);
  }

  undoSource(host: SurfaceHost, actor: Actor) {
    return this.inTurn(async () => {
      const e = this.msg && this.sourceHistory.last(partyOf(actor), this.msg.id);
      if (e?.patch) {
        const m = await host.ctx.board.readDraft(e.block), edit = e.edits[0]!;
        await this.patchSource(e.block, m.revision, edit.after, edit.before, e.patch.start, host, actor);
        this.sourceHistory.drop(e);
        if (this.sourcesMode) await this.readSources(this.sourcesMode.panel, host);
        return { block: e.block, line: edit.line + 1, recordedAs: mutationFor(actor) };
      }
      const r = await this.undoLines(this.sourceHistory, "source parameter", host, actor);
      return { block: r.block, line: r.edits[0]!.line + 1, text: r.edits[0]!.before, revision: r.revision, recordedAs: mutationFor(actor) };
    });
  }

  private sourcesModeOf(P: SourcesPanel, host: SurfaceHost): SourcesMode {
    const run = (name: string, args: Record<string, unknown> = {}) => { void this.runKey(name as keyof NoteActionArgs & string, args as never, host); };
    const mode: SourcesMode = {
      get keys() { return mode.view.field ? SOURCE_FIELD_KEYS : P.open === null ? SOURCES_KEYS : SOURCE_KEYS; },
      name: "sources", of: P, reveal: true, word: "sources", noun: "the sources", panel: P, holdsKeys: true, editing: () => !!P.inspector.field, covers: () => false,
      place: attachedPlaceOf(readState<{ place: string }>("sources-place.json")?.place) ?? "split", float: null, frame: null, room: { w: 0, h: 0 },
      rect: { x: 0, y: 0, w: 0, h: 0 }, draw: null, view: P.inspector, footer: 0,
      changed: () => { if (!P.loading) void this.readSources(P, host); },
      key: k => {
        const binding = modeBinding(mode.keys!, k);
        if (binding) run(binding.action, { ...binding.args, ...(binding.action === "sources.refresh" ? { all: P.open === null } : {}) });
        else {
          const intent = mode.view.intent(k);
          if (intent) run("sources.field", intent);
        }
        return true;
      },
      click: (x, y, host) => {
        if (mode.place === "tile" && host.attachment !== "sources") return undefined;
        y += host.attachment ? 0 : this.drawn?.heroRows ?? 0;
        const r = mode.rect;
        if (this.floatAt(x, y, host) === "comment") return undefined;
        if (mode.place === "inline" && y < (this.drawn?.top ?? 0) + (this.drawn?.heroRows ?? 0)) return undefined;
        if (x < r.x || x >= r.x + r.w || y < r.y || y >= r.y + r.h) {
          if (this.floatAt(x, y, host) === "sources") { run("sources.focus", { on: true }); return true; }
          if (this.modes.active(mode)) run("sources.focus", { on: false });
          return undefined;
        }
        if (y >= r.y + mode.footer) { run("sources.focus", { on: !this.modes.active(mode) }); return true; }
        run("sources.focus", { on: true });
        const hit = mode.draw?.hits.filter(h => h.row === y - r.y && x - r.x >= h.from && x - r.x < h.to).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
        if (hit) run(hit.action, hit.args);
        return true;
      },
      wheel: (dir, host, at) => { if (mode.place === "tile" && host.attachment !== "sources") return false; const r = mode.rect; if (!at || at.x < r.x || at.x >= r.x + r.w || at.y < r.y || at.y >= r.y + r.h) return false; run("sources.scroll", { by: wheelRows(dir) }); return true; },
      rows: () => null, leave: async () => { this.modes.drop("sources"); return { left: "nothing" }; },
      leaveRefusal: () => mode.view.field ? "finish the property field · Enter saves · Esc keeps" : null,
      unsaved: () => mode.view.unsaved(), keep: () => mode.view.keep(),
      hint: () => "sources has keys · " + modeHint(mode.keys!, action => NOTE_ACTIONS.def(action)), state: () => this.modes.active(mode) ? "sources" : null,
      describe: () => ({ keys: this.modes.active(mode) ? "sources" : "reader", selectedResult: (() => { const s = P.answer?.sources[P.open ?? -1]; const it = s && itemsOf(s, P.folds)[P.item]; return it?.kind === "result" ? it.block ?? null : null; })(), place: mode.place, block: P.block, view: P.open === null ? "list" : "source", ...(P.answer ? { readAt: P.answer.readAt, sources: P.answer.sources.map((s, i) => ({ n: i + 1, name: s.name, kind: s.kind, ...(i === P.open ? { open: true, folds: { ...P.folds }, item: P.item + 1 } : {}), ...(i === P.sel ? { selected: true } : {}) })) } : {}), ...(P.error ? { error: P.error } : {}), loading: P.loading }),
    };
    return mode;
  }

  async undoUse(host: SurfaceHost, actor: Actor) {
    const r = await this.inTurn(() => this.undoLines(this.useHistory, "::use", host, actor));
    return { block: r.block, line: r.edits[0]!.line + 1, text: r.edits[0]!.before, revision: r.revision, recordedAs: mutationFor(actor) };
  }

  /**
   * The `¶` on a `::fields` row (S3): the row's line gets an anchor (`fragments.ensure`, attributed), so `((note^anchor))`
   * links to it for good. The one thing a `::fields` writes, and only when asked: drawing it never does.
   */
  async anchorField(key: string | undefined, n: number, host: SurfaceHost, actor: Actor) {
    this.requireNote();
    const read = fieldsDrawn(this.fieldsDrawing, key);
    if ("problem" in read) throw new ActionRefused(read.problem);
    const drawnFields = read.found;
    // What was drawn may be gone from the note (edited away, drawn by a reader that has since moved on).
    const now = await this.whole();
    if (!fieldsBlocksOf(now.text).some(s => s.key.toLowerCase() === drawnFields.key.toLowerCase() && (s.of ?? null) === drawnFields.of)) {
      throw new ActionRefused(`this note no longer holds a ::fields{key=${drawnFields.key}}`);
    }
    const row = drawnFields.rows[n - 1];
    if (!row) throw new ActionRefused(`::fields{key=${drawnFields.key}} has rows 1 to ${drawnFields.rows.length}`);
    let anchored: { fragmentId: string; created: boolean };
    try { anchored = await host.ctx.board.ensureFragment(drawnFields.from, row.line, drawnFields.revision, actor); }
    catch (e) {
      const said = e instanceof Error ? e.message : String(e);
      // The list was drawn from an older text: it is read again (watched), and the row anchors once it is.
      const why = /changed since/.test(said) ? "not anchored: the note changed since the list was read; it is read again, press ¶ once more" : `not anchored: ${said}`;
      host.ctx.flash(why, undefined, errorDetails(e));
      throw new ActionRefused(why);
    }
    const link = blockRefText(drawnFields.from, "", { fragment: anchored.fragmentId });
    if (actor.kind === "user") host.ctx.copy?.(link);
    const said = `${anchored.created ? "anchored" : "already anchored"} line ${row.line + 1}: ${link}${actor.kind === "user" ? " · copied" : ""}`;
    host.ctx.flash(said);
    this.noteAgent(actor, said);
    host.redraw();
    return { block: drawnFields.from, noteLine: row.line + 1, anchor: anchored.fragmentId, created: anchored.created, link, recordedAs: mutationFor(actor) };
  }

  /**
   * A mark on a live `::graph-check` row (PIE-864): the row's own note gets the property its figure's `done:` names
   * (`x` that query's value, any other mark its status word), one attributed `properties.patch` at the revision its
   * tokens were read at. The figure redraws from the outline; Undo writes back what the property held.
   */
  private async markLiveRow(ref: StepRef, live: { key: string; done: string }, choice: StepChoice, host: SurfaceHost, actor: Actor) {
    const title = stepTitle(ref.step), before = ref.step.status;
    try {
      if (choice === "copy-link" || choice === "address") throw new ActionRefused(`a live row is its own note: its link is ((${ref.block})), and ⏎ on its words opens it`);
      const value = liveMarkValue(live, choice);
      // Checked against the row as drawn: a status changed since (elsewhere) is never written over.
      const w = await this.writeLive(ref.block, live.key, value, now => liveRowStatus(false, live, now ?? undefined) === before ? null : `its ${live.key}:: changed since it was drawn (it's ${now ?? "unset"} now): it's drawn again, choose again`, host, actor);
      if (w.changed) this.stepHistory.push({ block: ref.block, evidence: ref.step.evidence, status: before, to: choice, title, by: partyOf(actor), context: this.msg?.id ?? ref.block, live: { key: live.key, before: w.before, after: value } });
      const said = w.changed ? `set "${title}" ${live.key}::${value} (${statusWord(before)} → ${statusWord(choice)})` : `"${title}" already has ${live.key}::${value}`;
      host.ctx.flash(said); this.noteAgent(actor, said); host.redraw();
      return { block: ref.block, step: null, status: choice, from: before, changed: w.changed, revision: w.revision, property: { key: live.key, value }, recordedAs: mutationFor(actor) };
    } catch (e) {
      outlineChanged([ref.block]);
      const why = `not changed: ${e instanceof Error ? e.message : String(e)}`;
      host.ctx.flash(why, undefined, errorDetails(e)); host.redraw();
      throw new ActionRefused(why);
    }
  }

  /**
   * Set (or, null, remove) note `block`'s own `key` property: its first block token replaced, else one appended.
   * `refuse`: why what it holds now (null: none) can't be written over, or null when it can. Answers what it held
   * before and whether anything changed.
   */
  private async writeLive(block: string, key: string, value: string | null, refuse: (now: string | null) => string | null, host: SurfaceHost, actor: Actor) {
    const board = host.ctx.board;
    const no = agentRefusal(actor, { board, blockId: block });
    if (no) throw new ActionRefused(no);
    const t = await board.propertyTokens(block, key);
    const own = t.tokens.filter(x => x.scope === "block"), before = own[0]?.value ?? null;
    const no2 = refuse(before);
    if (no2) throw new ActionRefused(no2);
    const operations: PropertyPatch[] = value === null ? own.map(x => ({ op: "remove" as const, ordinal: x.ordinal }))
      : own.length ? (own[0]!.value === value ? [] : [{ op: "replace" as const, ordinal: own[0]!.ordinal, value }]) : [{ op: "append" as const, key, value }];
    if (!operations.length) return { before, changed: false, revision: t.revision };
    const saved = await board.patchProperties(block, t.revision, operations, actor);
    outlineChanged([block]);
    return { before, changed: true, revision: saved.revision ?? null };
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
    if (e.live) {
      // A live row's mark (PIE-864): its property back to what it held, refused if it changed again since.
      const live = e.live;
      let w: Awaited<ReturnType<NoteSurface["writeLive"]>>;
      try { w = await this.writeLive(e.block, live.key, live.before, now => (now === live.after ? null : `${live.key}:: changed since (it's ${now ?? "unset"} now)`), host, actor); }
      catch (err) {
        this.stepHistory.drop(e);
        const why = `couldn't undo: ${err instanceof Error ? err.message : String(err)}`;
        host.ctx.flash(why, undefined, errorDetails(err)); host.redraw();
        throw new ActionRefused(why);
      }
      this.stepHistory.drop(e);
      const said = `undid: "${e.title}" ${live.key}::${live.after} → ${live.before ?? "unset"}`;
      host.ctx.flash(said); this.noteAgent(actor, said); host.redraw();
      return { block: e.block, step: null, status: e.status, from: e.to, revision: w.revision, recordedAs: mutationFor(actor) };
    }
    // A row without an id stays at its recorded position only through our own box writes.
    let step: ChecklistStep = { ...(e.itemId ? { itemId: e.itemId } : {}), identity: e.itemId ? "unique" : "unassigned", status: e.to, evidence: e.evidence, span: { start: e.at?.start ?? 0, end: 0, startLine: 0, endLine: 0 }, depth: 0, text: e.title };
    let r: Awaited<ReturnType<SurfaceHost["ctx"]["board"]["changeStep"]>>;
    try {
      let revision = e.at?.revision ?? 0;
      r = await host.ctx.board.changeStep(e.block, step, revision, { kind: "status", status: e.status }, actor);
    } catch (err) {
      if (err instanceof Refused) this.stepHistory.drop(e);
      outlineChanged([e.block]);
      const why = `couldn't undo: ${err instanceof Error ? err.message : String(err)}`;
      host.ctx.flash(why, undefined, errorDetails(err));
      host.redraw();
      throw new ActionRefused(why);
    }
    this.stepHistory.drop(e);
    if (e.at) this.stepHistory.advance(e.block, e.at.revision, r.block.revision ?? 0);
    stepChanged(host.ctx.board, e.block, step, r.item, r.block.revision);
    embedStepChanged(host.ctx.board, r.block, step, r.item);
    outlineChanged([e.block]);
    if (this.msg?.id === e.block && !this.msg.partial) this.refresh({ ...r.block, childIds: this.msg.childIds });
    const said = `undid: "${e.title}" ${statusWord(e.to)} → ${statusWord(e.status)}`;
    // An agent's host says who it is (asActor); the person's says it plainly.
    host.ctx.flash(said);
    this.noteAgent(actor, said);
    host.redraw();
    return { block: e.block, step: e.itemId ?? null, status: r.item.status, from: e.to, revision: r.block.revision ?? null, recordedAs: mutationFor(actor) };
  }

  /** The steps this reader draws, in reading order, as `tasks` lists them. */
  describeSteps() {
    return this.elems.filter(e => e.kind === "task" && e.task).map((e, i) => {
      const t = e.task!;
      // A live figure's row (PIE-864) is a note of its own: it has no line here.
      return { n: i + 1, id: t.step.itemId ?? null, block: t.block, in: t.live ? "a live figure" : t.via ?? "this note", status: t.step.status, text: printable(stepTitle(t.step)), line: t.live ? null : t.step.span.startLine + 1, current: e.key === this.cur };
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
    const { lines, rows } = hit.callout ? calloutPanel(hit.callout, P, W) : pickerPanel(hit.ref!, P.list.items, P.list.sel, P.note, P.busy, W);
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
    const name = `${subject(m)} ^${fragment}`;
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

  /**
   * Scroll to the line of this note that holds a reference (a backlinks row opened, PIE-884: `at`, the reference's
   * offset in the text the service read) and mark it, as an anchored link's fragment is. Folds around it open.
   */
  async revealAt(at: number, host: SurfaceHost, by: Actor = USER, label?: string, says?: string) {
    const m = this.msg;
    if (!m) return;
    const from = this.scroll;
    let now: Msg;
    try { now = await this.whole(); } catch { return; }
    if (now.id !== m.id) return;
    // The offset is the service's read of the note; edited since, the reference is looked for where it was, else the nearest one.
    let where = at;
    if (label && now.text.slice(at, at + label.length) !== label) {
      const all: number[] = [];
      for (let i = now.text.indexOf(label); i >= 0; i = now.text.indexOf(label, i + 1)) all.push(i);
      if (!all.length) { host.ctx.flash(`${label} isn't in the note any more · it opens at the top`); return; }
      where = all.reduce((best, i) => (Math.abs(i - at) < Math.abs(best - at) ? i : best));
    }
    const line = now.text.slice(0, Math.max(0, Math.min(where, now.text.length))).split("\n").length - 1;
    const { points, lines } = this.foldsIn(now);
    const shown = lines.indexOf(line);
    for (const p of points) if (this.folded.has(p.key) && shown >= 0 && p.line < shown && shown < p.end) this.folded.delete(p.key);
    this.focusMark = { by, spec: { line: line + 1, to: line + 1 }, label: `line ${line + 1}`, at: Date.now(), line: true, ...(says ? { says } : {}) };
    // A front-matter property line isn't drawn in the note (the property panel, `i`, holds it): said, rather than a mark nobody can see.
    if (line > 0 && parsePropertyRecords(now.text).some(p => p.line === line && p.scope === "block" && p.syntax !== "hashtag")) host.ctx.flash(`line ${line + 1} is a front-matter property: it's in the property panel (i)`);
    this.revealMark = this.scroll === from;
    host.redraw();
  }

  // ── zoom into a part (PIE-780) ─────────────────────────────────────────────

  /**
   * Zoom into the part of the note holding note line `line` (or anchored `^anchor`): the one element.detach takes there,
   * as the service finds it (`fragments.at`, `fragments.read`), never a part rule of the door's own. The reader keeps
   * reading the same note, only its lines (`foldsIn`), from the top; where it was goes on its back trail, so back, esc and
   * a click on `← back` return to it as it was.
   */
  async zoomInto(at: { line?: number; anchor?: string }, host: SurfaceHost): Promise<Zoom> {
    const m = this.msg;
    if (!m || !isOutlineNote(m)) throw new ActionRefused("no note here to zoom into");
    if (m.partial) throw new ActionRefused("the note is still being read: zoom again in a moment");
    const holding = this.modes.holding();
    if (holding) throw new ActionRefused(`finish ${holding} first · ${this.holdingHint()}`);
    const zoom = await this.partOf(m, at, host.ctx.board);
    if (this.msg !== m) throw new ActionRefused("the reader moved meanwhile");
    if (this.zoom && this.zoom.start === zoom.start && this.zoom.end === zoom.end) return this.zoom;
    const from = this.place();
    if (from) { this.backs.push(from); if (this.backs.length > HISTORY) this.backs.shift(); this.aheads = []; }
    this.zoom = zoom; this.zoomTurn++;
    this.scroll = 0; this.position.view = null; this.position.reading = 0; this.letGo(); this.elems = [];
    this.keptChanged?.();
    host.redraw();
    return zoom;
  }

  /** The zoom's row (PIE-780), in place of the crumbs: the part, the note it is in, and the key back. */
  private zoomBar(m: Msg, w: number): string {
    const z = this.zoom!, back = ZOOM_KEYS.find(k => k.args?.on === false)!;
    // A table is a paragraph to the service, labelled by its words: named here by its header's cells, as drawn.
    const lines = m.text.split("\n"), label = z.kind === "paragraph" && startsTable(lines, z.start) ? `table · ${tableCells(lines[z.start]!).map(c => c.text).join(", ")}` : z.label;
    return drawEllipsized(`${fg(C.lcyan)}${ZOOM_GLYPH} ${printable(label)}${fg(C.dark)} · in ${printable(subject(m))} · ${fg(C.lcyan)}← ${keyCaption(back.key)} ${back.label}`, w) + RESET;
  }

  /** The part `at` names in `m` (PIE-780), read from the service: refused, with why, where there is none. */
  private async partOf(m: Msg, at: { line?: number; anchor?: string; follow?: true }, board: SocketBoard): Promise<Zoom> {
    if (at.anchor !== undefined) {
      const r = await board.readFragment(m.id, at.anchor.replace(/^\^/, ""));
      if (r.status === "missing") throw new ActionRefused(`this note has no ^${at.anchor.replace(/^\^/, "")}`);
      if (r.status === "duplicate") throw new ActionRefused(`^${r.fragmentId} is in this note more than once: zoom by line= instead`);
      const f = r.fragment;
      return { start: f.startLine, end: f.endLine, line: f.startLine, kind: f.kind, label: f.label, anchor: r.fragmentId, revision: r.revision };
    }
    const line = at.line ?? this.elementLine();
    if (line === undefined) throw new ActionRefused("nothing to zoom into here: put the [ ] position or the reading line on a figure, a table or a heading");
    // Where the reader is (no line= named): the part there, else the next one, as element.detach takes it.
    const r = await board.partAt(m.id, line, at.line === undefined && !at.follow);
    if (!r.part) throw new ActionRefused(`line ${line + 1} is in no part (a figure, a table, a heading's section, a callout, a list item or a paragraph): nothing to zoom into`);
    const p = r.part;
    // Its anchor's line as it reads (`head`): a part with no anchor is found again by it when lines move above it.
    const head = m.text.split("\n")[p.lineIndex];
    return { start: p.startLine, end: p.endLine, line: p.lineIndex, kind: p.kind, label: p.label, ...(p.fragmentId ? { anchor: p.fragmentId } : {}), revision: r.revision, ...(head !== undefined ? { head } : {}) };
  }

  /** The zoomed note changed (PIE-780): the part is read again (by its anchor, else its first line), or the zoom lets go, said, when it's gone. */
  private async followZoom(m: Msg) {
    const z = this.zoom, board = this.src?.board, turn = this.zoomTurn;
    if (!z || !board) return;
    // With no anchor, its line where it reads as it did (the nearest such), else the line it was on.
    const lines = m.text.split("\n"), same = lines.flatMap((l, i) => (l === z.head ? [i] : [])).sort((a, b) => Math.abs(a - z.line) - Math.abs(b - z.line))[0];
    const next = await this.partOf(m, z.anchor ? { anchor: z.anchor } : { line: same ?? z.line, follow: true }, board).catch(() => null);
    // Only the newest revision's read lands (each change starts its own), and only on the zoom it was asked for.
    if (this.zoomTurn !== turn || this.msg?.id !== m.id || this.msg.revision !== m.revision) return;
    if (next) this.zoom = next;
    else { this.zoom = null; this.zoomTurn++; this.context?.flash(`the part you zoomed into (${z.label}) is gone from the note: showing the whole note`); }
    this.src?.redraw();
  }

  /**
   * Leave the zoom (PIE-780): back one step, when the top of the reader's trail is the same note (the whole note, or the part
   * this one was zoomed from), so forward zooms in again; else only the zoom lets go. Null when it went, else why not.
   */
  async unzoom(host: SurfaceHost, actor: Actor): Promise<string | null> {
    const z = this.zoom;
    if (!z) return "not zoomed: element.zoom zooms into a part";
    // One step back, as the zoom's row and alt+← go: from a part zoomed inside another, to that one.
    const to = this.backs.at(-1);
    if (to && to.msg.id === this.msg?.id) return this.travel(-1, host, actor);
    this.zoom = null; this.zoomTurn++; this.scroll = 0; this.letGo(); this.keptChanged?.();
    host.redraw();
    return null;
  }

  // ── back and forward (PIE-453) ─────────────────────────────────────────────

  /** Where the reader is now, as back would come back to it. */
  private place(): Place | null {
    const m = this.msg;
    return m ? { msg: m, position: structuredClone(this.position), cur: this.cur, link: this.link, folded: [...this.folded], previewLists: [...this.previewLists], previewOpen: [...this.previewOpen], expanded: [...this.expanded], foldedThreads: [...this.foldedThreads], seen: [...this.foldSeen], figures: [...this.figureUI], zoom: this.zoom } : null;
  }

  /**
   * Run a navigation (a followed link, `u`, or a host opening a note into this reader on purpose: an agent's
   * `open`, a card's ⏎ into a detail, a selection wired to it: a links tile's pick, a preview's source, PIE-1426) so
   * that, when it leaves this reader on another note, back comes here, whichever tile changed it (a wired preview is
   * tracked too).
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
      this.keptChanged?.();
    }
    return out;
  }

  /** Back (-1) or forward (1) walks this reader's own stops, not the view's trail (SurfaceHost.history). */
  travelsHere(dir: -1 | 1): boolean { return (dir < 0 ? this.backs : this.aheads).length > 0; }

  /** The title back (-1) or forward (1) would show, or null. */
  peek(dir: -1 | 1): string | null {
    const p = (dir < 0 ? this.backs : this.aheads).at(-1);
    return p ? subject(p.msg) : this.kept?.peek(dir) ?? null;
  }

  /**
   * Back (-1) or forward (1): this reader shows the note it showed there, re-read, scrolled and with its `[ ]`
   * position, folds and expanded threads as they were, so ⏎ and alt+⏎ act on the same element at once. Only
   * this reader moves (in place, not through the host's navigate: nothing else follows it). Where the view
   * keeps a trail (SurfaceHost.history), that trail takes over after local replacements. Null when it went, else why not.
   */
  async travel(dir: -1 | 1, host: SurfaceHost, actor: Actor = USER, steps = 1): Promise<string | null> {
    this.use(host);
    // `steps` stops at once (the trail's choice, PIE-208): the ones passed over go on the other stack, as one by one.
    const stack = dir < 0 ? this.backs : this.aheads, to = stack[stack.length - steps];
    if (!stack.length && host.history) return host.history.go(dir, actor, steps);
    if (!to && stack.length) return `only ${stack.length} ${dir < 0 ? "back" : "ahead"}: steps=${stack.length} at most (trail lists them)`;
    if (!to) return dir < 0 ? "nothing to go back to: this reader hasn't followed a link here" : "nothing ahead: go back first";
    const holding = this.modes.holding();
    if (holding) return `finish ${holding} first · ${this.holdingHint()}`;
    const fresh = await readNote(outlineBoards(host.ctx).home(), to.msg.id, to.msg.address).catch(() => null);
    if (stack[stack.length - steps] !== to) return "the reader moved meanwhile";
    const here = this.place();
    const note = fresh ?? to.msg;
    if (host.contextFor) host = { ...host, ctx: host.contextFor(note) };
    if (!this.show(note, host)) return holdsEdit("the reader");
    const passed = stack.splice(stack.length - steps).slice(1).reverse(), other = dir < 0 ? this.aheads : this.backs;
    if (here) other.push(here);
    other.push(...passed);
    this.restorePlace(to);
    host.historyLanded?.(actor);
    // A redraw may paint synchronously; the host must keep the destination before its view reads it.
    this.keptChanged?.();
    host.redraw();
    return null;
  }

  /**
   * The reader's place and its back and forward stacks, as a layout saves them (PIE-643): a handover or a restart
   * gives the reader back where it was. A view-owned trail is kept by the layout; local replacements still save
   * their own Back and Forward steps.
   */
  saveNav(): SavedNav | null {
    if (this.kept && !this.backs.length && !this.aheads.length) return null;
    const here = this.place();
    const out: SavedNav = { v: NAV_VERSION, ...(here ? { here: savedPlace(here) } : {}), backs: this.backs.map(savedPlace), aheads: this.aheads.map(savedPlace) };
    return here || out.backs.length || out.aheads.length ? out : null;
  }

  /**
   * Take a saved place back (the layout's, validated here): the stacks always, and where this reader was when it is
   * showing that same note now. Whatever isn't this version's shape is dropped, never guessed at. True when anything was taken.
   */
  restoreNav(raw: unknown): boolean {
    const nav = readNav(raw);
    if (!nav) return false;
    this.backs = nav.backs.map(placeOf); this.aheads = nav.aheads.map(placeOf);
    const here = nav.here;
    if (here && this.msg?.id === here.id) {
      this.restorePlace(placeOf(here));
    }
    return true;
  }

  private restorePlace(to: Place) {
    Object.assign(this.position, structuredClone(to.position)); this.cur = to.cur; this.link = to.link;
    this.folded = new Set(to.folded); this.previewLists = new Map(to.previewLists); this.previewOpen = new Set(to.previewOpen); this.expanded = new Set(to.expanded); this.foldedThreads = new Set(to.foldedThreads); this.foldSeen = new Set(to.seen); this.figureUI = new Map(to.figures); this.zoom = to.zoom ?? null; this.zoomTurn++;
    // A zoom taken back onto a note that changed since: its part is read again for this revision.
    if (this.zoom && this.msg && !this.msg.partial && this.msg.revision !== this.zoom.revision) void this.followZoom(this.msg);
    // The element comes into view if the history row now under the note would hide it (only that far).
    this.reveal = to.cur !== null;
  }

  /** Keep both trails when automatic placement folds another reader into this one. */
  takeHistory(from: NoteSurface) {
    const here = from.place();
    if (here) this.restorePlace(here);
    this.backs = [...this.backs, ...from.backs].slice(-HISTORY);
    this.aheads = [...this.aheads, ...from.aheads].slice(-HISTORY);
  }

  /** The history as `peek` shows it: the titles back and forward go to, nearest first. */
  describeHistory() {
    const trail = this.kept && !this.backs.length && !this.aheads.length ? this.kept.trail?.() : undefined;
    if (trail) return { back: trail.back, forward: trail.forward, keptBy: "view" };
    if (this.kept && !this.backs.length && !this.aheads.length) return { back: [this.kept.peek(-1)].filter(Boolean), forward: [this.kept.peek(1)].filter(Boolean), keptBy: "view" };
    const titles = (ps: Place[]) => ps.map(p => ({ ...(p.msg.address ? { address: p.msg.address } : {}), id: p.msg.id, title: subject(p.msg) })).reverse();
    return { back: titles(this.backs), forward: titles(this.aheads) };
  }

  /**
   * The trail (PIE-208): where this reader has been and may go again, read from the one history back and forward walk
   * (this reader's stacks, or the view's where it keeps them). The person's opens it as a list over the screen, the
   * note shown lit between the stops ahead (above) and back (below); a choice is back or forward that many steps.
   * An agent's answers the stops and opens nothing.
   */
  trailOf(): Trail {
    const h = this.describeHistory(), m = this.msg;
    // A view that keeps its trail without listing it says only the next title each way.
    const stops = (ss: readonly unknown[]): TrailStop[] => ss.flatMap(s => (typeof s === "string" ? [{ title: s }] : s ? [s as TrailStop] : []));
    return { here: m ? { id: m.id, title: subject(m) } : null, back: stops(h.back), forward: stops(h.forward), ...(h.keptBy ? { keptBy: h.keptBy } : {}) };
  }
  async trail(host: SurfaceHost, standing: boolean) {
    const answer = this.trailOf(), { back, forward } = answer;
    if (!standing) return { ...answer, shown: false };
    if (!back.length && !forward.length) throw new ActionRefused("no trail yet: this reader hasn't followed a link (follow one, then alt+T)");
    // A screen of tiles: a trail tile beside the reader, docked, resized and closed like any (PIE-1425); else the list over it.
    const tile = host.trailTile ? await host.trailTile() : null;
    if (tile) return { ...answer, shown: true, tile };
    if (!host.overlay) throw new ActionRefused(`this screen can't list the trail over it · ${back.length ? `back steps=${back.length} goes to ${back.at(-1)!.title}` : "forward goes on"}`);
    const rows = trailRows(answer);
    const list = new ListPicker<TrailRow, unknown>({
      name: "trail", items: () => rows, clickChooses: true,
      // One row a stop, so the box is as tall as the trail; a title cut short reads in full on hover (Overflow).
      row: (r, _i, on, w) => [pickRow(trailLine(r), on, w)],
      choose: r => { if (r.dir) void this.runKey(r.dir < 0 ? "back" : "forward", { steps: r.steps }, host); },
      frame: (a, n) => ({ rect: centred(a, Math.min(64, a.cols - 2), Math.min(n + 2, a.rows)), title: "trail · where this reader has been" }),
    });
    list.sel = forward.length;
    host.overlay(list);
    return { ...answer, shown: true };
  }

  // ── selecting text (PIE-419) ───────────────────────────────────────────────

  /** The last render's rows, by content row: the header's (its rule isn't text), then the body's (margin left out). */
  private selRows(noteOnly = false): SelectRows | null {
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
      // The body's inset (the look's margin.x, PIE-673) and a shaded region's gutter are drawn, never copied.
      margin: r => (r < d.top ? 0 : d.body[r - d.top]?.startsWith(" ".repeat(d.bx) + SHADE) ? d.bx + 1 : d.bx),
      // The drawing inside the text (a quote's bar, a frame's edges, a bullet glyph, a fold arrow) is drawn, never copied (PIE-638).
      cuts: r => (r < d.top ? undefined : d.doc.trims.get(r - d.top)?.cuts.map(([a, b, rep]) => [a + d.bx, b + d.bx, rep] as const)),
      // A row that is only drawing (a frame's edge; the look's gap, divider and margin rows) is left out whole.
      edge: r => (r >= d.top ? (noteOnly && d.doc.source[r - d.top] === -1) || !!d.doc.trims.get(r - d.top)?.edge : r >= d.top - 1 - d.my && r < d.top - 1),
      // A paragraph wrapped over rows is one line of text: its rows join with a space where the wrap took one, nothing where it cut a word.
      joins: r => (r >= d.top ? d.doc.wraps?.get(r - d.top + 1) : undefined),
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
      if (this.scroll < this.endScroll) this.scroll++;
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
  press(x: number, y: number, host: SurfaceHost, shift = false, keepCursor = false): void {
    this.use(host);
    const hit = !this.draft && this.formHit(x, y);
    if (hit && "link" in hit && hit.link.form) {
      const field = hit.link.form.field, spec = this.form?.fields.find(f => f.name === field);
      if (spec && spec.type !== "choice") {
        void this.runKey("form.place", { field, col: x - hit.from, extend: shift }, host);
        this.gesture.press(x, y); this.shiftPress = shift; return;
      }
    }
    this.dragging = false;
    if (this.placementMenu) { this.gesture.press(x, y); return; }
    // The header image (PIE-1361): its bottom row sizes it, the picture above that moves its focus.
    // Its rows as drawn: under a title written over it, the picture runs on under the title's rows.
    const heroRows = host.attachment || !(this.drawn?.heroRows) || !this.hero ? 0 : this.hero.pinned || !this.scroll ? this.hero.picture : this.drawn.heroRows;
    if (!this.editing && this.hero && heroRows > 0 && y >= 0 && y < heroRows && !this.floatAt(x, y, host)) {
      const spec = this.msg && this.imagesIn(this.msg).find(r => r.line === this.hero!.line)?.spec;
      this.heroDrag = { kind: y === heroRows - 1 ? "height" : "focus", x, y, rows: this.hero.picture, cols: this.drawn?.w ?? 80, focus: spec?.focus ?? { x: 0.5, y: 0.5 }, line: this.hero.line };
      this.gesture.press(x, y);
      return;
    }
    const float = this.floatAt(x, y, host);
    const ep = this.editPreview;
    if (float === "draft" && this.draft?.preview && ep.place === "floating" && ep.frame) {
      const zone = frameZone(ep.frame, x, y);
      if (zone) { this.frameDrag = { target: "edit-preview", zone, x, y, from: ep.frame }; return; }
    }
    const split = !float && this.splitDrawn.find(s => (s.beside ? x : y) === s.edge);
    if (split) { this.splitDrag = split; return; }
    const sm = this.sourcesMode, r = sm?.rect;
    const zone = float === "sources" && sm?.place === "floating" && sm.frame ? frameZone(sm.frame, x, y) : null;
    if (zone && sm?.frame) { this.frameDrag = { target: "sources", zone, x, y, from: sm.frame }; return; }
    if (sm && (sm.place !== "tile" || host.attachment === "sources") && r && (sm.place !== "inline" || y >= (this.drawn?.top ?? 0) + (this.drawn?.heroRows ?? 0)) && this.floatAt(x, y, host) !== "comment" && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
      if (y >= r.y + sm.footer) { this.gesture.press(x, y); return; }
      void this.runKey("sources.select", { phase: "start", row: y - r.y - 1 + sm.view.top, col: x - r.x }, host);
      return;
    }
    if (float === "sources") { this.gesture.press(x, y); return; }
    // On a property value being typed: the line field's own press (its cursor, a word on a double click), PIE-1290.
    if (this.panel?.fieldMouse("down", x, y)) { host.redraw(); return; }
    const n = this.gesture.press(x, y);
    // In a draft a press puts the cursor there (shift+click: selects from where it was), a drag from it selects, a
    // double click selects the word and a triple click the line (Draft's own selection, through draft.place).
    const replies = this.replyLinks;
    if (replies) {
      const row = this.replyRowAt(x, y);
      replies.dragFrom = !this.editing && row?.kind === "child" ? { block: row.child.block, y } : undefined;
    }
    this.editPress = false;
    const beside = this.besideRect;
    if (this.editing && (!this.replyParent || !beside || (x >= beside.x && y >= beside.y))) {
      // The composer is drawn in the note (PIE-770), under its header image: its cells are the note's, as a click's are.
      y -= this.drawn?.heroRows ?? 0;
      // `keepCursor`: the press that brought the keys back to a draft left open here (PIE-812). It still presses (a
      // frame control runs on its release), but the cursor and selection stay where the person left them.
      const d0 = keepCursor ? this.writingDraft : null;
      this.keptCursor = d0 ? { d: d0, row: d0.row, col: d0.col, anchor: d0.anchor, follow: d0.follow } : null;
      this.editPress = this.modes.press(x, y, host, shift);
      this.restoreCursor(false);
      this.shiftPress = shift && this.editPress;
      const d = this.writingDraft;
      this.draftSelecting = this.editPress && d && n > 1 && !shift ? this.selectInDraft(d, n, host) : null;
      if (this.editPress) host.redraw();
      return;
    }
    if (n < 2) return;
    const rows = this.selRows(), p = this.posAt(x, y);
    if (!rows || !p || !rows.cells(p.row).length) return;
    this.selection = this.stamp(n === 2 ? wordAt(rows, p) : lineAt(rows, p.row));
    host.redraw();
  }

  /** The pointer moved with the button down: once off the pressed cell, it selects from there. */
  drag(x: number, y: number, host: SurfaceHost): void {
    if (this.panel?.fieldMouse("drag", x, y)) { host.redraw(); return; }
    const hd = this.heroDrag;
    if (hd) {
      if (hd.saving || (x === hd.x && y === hd.y && !hd.now)) return;
      const clamp = (v: number) => Math.max(0, Math.min(1, Math.round(v * 100) / 100));
      hd.now = hd.kind === "height"
        ? { height: Math.max(3, Math.min(this.hero?.max ?? hd.rows, hd.rows + y - hd.y)) }
        // The picture follows the pointer: dragged right, the crop shows more of its left.
        : { focus: { x: clamp(hd.focus.x - (x - hd.x) / Math.max(1, hd.cols)), y: clamp(hd.focus.y - (y - hd.y) / Math.max(1, hd.rows)) } };
      host.redraw();
      return;
    }
    if (this.modes.get("form")) {
      const hit = this.formHit(x, y);
      if (hit && "link" in hit && hit.link.form?.field === this.form?.fields[this.form.focus]?.name) {
        this.gesture.drag(x, y);
        void this.runKey("form.place", { field: hit.link.form!.field, col: x - hit.from, extend: true }, host);
        return;
      }
    }
    if (this.splitDrag) {
      const s = this.splitDrag;
      void this.runKey("attachment.split", { target: s.target, share: 1 - (s.beside ? x / s.w : y / s.h) }, host);
      return;
    }
    if (this.frameDrag?.target === "sources" || this.frameDrag?.target === "edit-preview") { this.dragFrame(x, y, host); return; }
    const sm = this.sourcesMode;
    if (sm?.view.pressed) { void this.runKey("sources.select", { phase: "drag", row: Math.max(0, y - sm.rect.y - 1) + sm.view.top, col: Math.max(0, x - sm.rect.x) }, host); return; }
    if (this.replyLinks?.dragFrom) { this.gesture.drag(x, y); return; }
    const g = this.gesture.pressed;
    if (this.editing && (!this.replyParent || this.editPress)) { this.gesture.drag(x, y); if (this.editPress && this.modes.press(x, y - (this.drawn?.heroRows ?? 0), host, true)) host.redraw(); return; }
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
  /** Put back the cursor a press that brought the keys back kept (PIE-812); `done` at its release, which ends it. */
  private restoreCursor(done: boolean) {
    const k = this.keptCursor;
    if (k) { k.d.row = k.row; k.d.col = k.col; k.d.anchor = k.anchor; k.d.follow = k.follow; }
    if (done) { if (k) this.gesture.forget(); this.keptCursor = null; }
  }

  release(x: number, y: number, host: SurfaceHost): boolean {
    try { return this.releaseNow(x, y, host); } finally { this.restoreCursor(true); }
  }

  private releaseNow(x: number, y: number, host: SurfaceHost): boolean {
    if (this.panel?.fieldMouse("up", x, y)) { host.redraw(); return true; }
    const hd = this.heroDrag;
    if (hd && !hd.saving) {
      this.gesture.release(x, y);
      if (!hd.now) { this.heroDrag = null; return this.click(x, y, host); }
      // Drawn where it was let go until its save lands, so the header never snaps back first.
      hd.saving = true;
      const r = (v: number) => String(Math.round(v * 100) / 100);
      const saved = hd.now.height !== undefined ? this.runKey("image.size", { line: hd.line + 1, height: String(hd.now.height) }, host)
        : this.runKey("image.look", { line: hd.line + 1, focus: `${r(hd.now.focus!.x)},${r(hd.now.focus!.y)}` }, host);
      void saved.finally(() => { if (this.heroDrag === hd) this.heroDrag = null; host.redraw(); });
      host.redraw();
      return true;
    }
    if (this.placementMenu) return this.modes.click(x, y, host) ?? false;
    if (this.splitDrag) { this.splitDrag = null; host.redraw(); return true; }
    if (this.frameDrag?.target === "sources" || this.frameDrag?.target === "edit-preview") { this.frameDrag = null; host.redraw(); return true; }
    if (this.listEditor.field && this.listEditor.pressed) {
      const selected = this.listEditor.editorPressed && !!this.listEditor.field.session.draft.selectedText();
      const gesture = this.gesture.release(x, y);
      this.listEditor.release();
      if (gesture.click && !selected) this.click(x, y, host);
      host.redraw(); return true;
    }
    const sm = this.sourcesMode;
    if (sm?.view.pressed) {
      const selected = !!sm.view.selection || sm.view.editorPressed && !!sm.view.field?.session.draft.selectedText();
      sm.view.release();
      if (selected) void this.runKey("sources.copy", {}, host);
      else this.click(x, y, host);
      return true;
    }
    const r = this.gesture.release(x, y);
    const from = this.replyLinks?.dragFrom;
    if (this.replyLinks) this.replyLinks.dragFrom = undefined;
    if (from && !r.click) {
      const row = this.replyRowAt(x, y);
      if (row?.kind === "child" && row.child.block.id !== from.block.id) {
        const target = row.child.block.id;
        void this.runKey("note.move", { id: from.block.id, revision: from.block.revision,
          ...(x < this.replyLinks!.rect.x + 4 ? y > from.y ? { after: target } : { before: target } : { to: target }) }, host);
      }
      return true;
    }
    this.dragging = false;
    // The end of a drag that moved or sized the floating composer: nothing else (not a click in it).
    if (this.frameDrag) { this.frameDrag = null; this.editPress = false; host.redraw(); return true; }
    // A shift+click in a draft extended its selection: the release copies it (copy on select), never places the cursor again.
    if (this.shiftPress) {
      this.shiftPress = false;
      const d = this.writingDraft;
      if (d?.selectedText()?.trim() && copyOnSelect()) void this.runKey("draft.copy", {}, host);
      host.redraw();
      return true;
    }
    const completion = this.writingDraft && completerOf(this.writingDraft);
    if (completion?.overPreview(x, y)) {
      completion.click(y, x, text => host.ctx.copy?.(text, "component preview"));
      host.redraw(); return true;
    }
    if (r.click) {
      // A click that did something (a link, a fold, a panel row) isn't the first half of a double click.
      const acted = this.click(x, y, host);
      // In a draft a click only places the cursor: the next on its cell is still a double click (the word).
      if (acted && (!this.editing || this.writingDraft && completionOf(this.writingDraft))) this.gesture.forget();
      return acted;
    }
    // In a draft: the draft's own selection, copied the same way (draft.copy), when the mouse made it (a double or
    // triple click's word or line once it's selected).
    const d = this.editing && (!this.replyParent || this.editPress) && r.copy ? this.writingDraft : null;
    if (d) {
      void (this.draftSelecting ?? Promise.resolve()).then(() => { if (d.selectedText()?.trim()) void this.runKey("draft.copy", {}, host); host.redraw(); });
      return true;
    }
    const s = this.selection, rows = s && (!this.editing || (this.replyParent && !this.editPress)) && r.copy ? this.selRows() : null;
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
    // The passage toolbar goes on the line too: when it all fits beside the count and [Y source] they stay; else they
    // give it their room (Y still copies the source).
    const bar = this.msg && !this.msg.partial && s.text(rows).trim() ? this.passageChoices() : [];
    const full = `── ${n} chars ${copy} ${source} · `.length + width(toolbarRow(bar, this.passageMenu, w).text.replace(/\x1b\[[\d;]*m/g, ""));
    const compact = bar.length > 0 && full > w;
    const lead = compact ? "" : `── ${n} chars `;
    const at = d.top - 1, wide = !compact && lead.length + copy.length + 1 + source.length <= w, fits = !!lead && lead.length + copy.length <= w;
    const from = fits ? lead.length : 0;
    if (copy.length > w) return;
    this.hits.push({ row: at, from, to: from + copy.length, copy: "visible" });
    if (wide) this.hits.push({ row: at, from: from + copy.length + 1, to: from + copy.length + 1 + source.length, copy: "source" });
    let shown = (fits ? fg(C.blue) + "── " + fg(C.white) + `${n} chars ` : "") + fg(C.lcyan) + copy + (wide ? " " + source : "");
    // The passage toolbar (ADR 0004 contract 5): what can be done with these words, each a click, and after `a` a key.
    if (bar.length) {
      const left = width(shown) + 3, row = toolbarRow(bar, this.passageMenu, w - left);
      if (row.hits.length) {
        shown += fg(C.grey) + " · " + row.text;
        for (const x of row.hits) this.hits.push({ row: at, from: left + x.from, to: left + x.to, passage: x.action });
      }
    }
    d.head[at] = pad(shown + fg(C.blue) + "─".repeat(Math.max(0, w - width(shown))), w) + RESET;
  }

  /**
   * The marks on the words (ADR 0004 contract 6), by content row: each annotation's passage where it's drawn, in its
   * tone (a resolved thread's only when it's a highlight), and each `place: span` rule decoration's hit. Worked out once
   * per layout, from where the words are drawn (a passage whose words aren't drawn as they read is marked on its lines).
   */
  private spansOf(laid: Laid, m: Msg, src: Source | null): Map<number, { from: number; to: number; bg: string }[]> {
    if (laid.spans) return laid.spans;
    const out = new Map<number, { from: number; to: number; bg: string }[]>();
    const put = (sel: Selection | null, bg: string) => {
      if (!sel || !bg) return;
      for (let r = sel.start.row; r <= sel.end.row; r++) {
        const cells = r >= (this.drawn?.top ?? 0) ? width(laid.body[r - this.drawn!.top] ?? "") : 0;
        const sp = sel.span(r, cells);
        if (!sp) continue;
        const g = out.get(r);
        if (g) g.push({ from: sp[0], to: sp[1], bg }); else out.set(r, [{ from: sp[0], to: sp[1], bg }]);
      }
    };
    laid.spans = out;
    if (!this.drawn) return out;
    for (const c of this.commentsFor === m.id ? this.comments ?? [] : []) {
      if (c.start === null || c.end === null || (!c.open && kindOf(c) !== "highlight")) continue;
      put(this.passageSelection(c), spanBg(c.props));
    }
    // A rule's span decoration (place: span) on the characters its text pattern hit.
    if (isOutlineNote(m) && !this.raw) for (const d of decorationsOf(m, src)) {
      const at = d.place === "span" ? d.hit.span : undefined;
      if (!at || at.end <= at.start) continue;
      const tone = (d.view as { tone?: string } | undefined)?.tone;
      put(this.passageSelection({ start: at.start, end: at.end, quote: m.text.slice(at.start, at.end) } as Comment), toneBg(tone));
    }
    return out;
  }

  /**
   * The margin's side column, `cols` wide, beside the body rows shown: each card at its passage's row (placed in the
   * layout so none overlap), a dim rule where there's none. A click on a card expands its thread inline.
   */
  private drawMargin(lines: string[], laid: Laid, top: number, room: number, bodyW: number, cols: number, itemRows: [number, number] | null) {
    const byRow = new Map<number, { thread: string; text: string }>();
    for (const c of laid.margin.cards) c.rows.forEach((t, j) => byRow.set(c.at + j, { thread: c.thread, text: t }));
    for (let i = top; i < lines.length && i - top < room; i++) {
      const r = i - top + this.scroll, card = byRow.get(r);
      // Only a card's rows have the column's edge: the margin is quiet where it holds nothing.
      const text = card && itemRows && top + r >= itemRows[0] && top + r < itemRows[1] ? paintRange(pad(card.text, cols - 2), 0, cols - 2, ITEM_BG) : card?.text;
      lines[i] = pad(lines[i]!, bodyW) + (card ? fg(C.dark) + "│" + RESET + " " + text : " ".repeat(cols));
    }
    for (const card of laid.margin.cards) for (const l of card.links) {
      const row = top + card.at + l.line, from = bodyW + 2 + l.from, to = bodyW + 2 + l.to;
      const e = this.elems.find(e => e.row === row && e.from === from && e.link);
      if (row - this.scroll >= top && row - this.scroll < top + room)
        this.hits.push({ row: row - this.scroll, from, to, link: laid.drawn[l.n]!, elem: e?.key });
    }
    for (const card of laid.margin.cards) for (const c of card.controls) {
      const row = top + card.at + c.row, from = bodyW + 2 + c.from, to = bodyW + 2 + c.to;
      const key = controlKey(c.thread, c.control, c.value);
      if (row - this.scroll >= top && row - this.scroll < top + room)
        this.hits.push({ row: row - this.scroll, from, to, thread: c.thread, elem: key });
    }
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
      // y on a code block, a quote or a callout (or something in one) that is the current element copies its text (PIE-638).
      if (c === "y" && e && this.blockOf(e) !== null) { void this.runKey("block.copy", {}, host); return true; }
      // Y with nothing selected copies the whole note's source (note.copy); with a selection it is that selection's source.
      if (c === "Y") { void this.runKey("note.copy", {}, host); return true; }
      if (c === "y") { host.ctx.flash("nothing is selected · drag across the text, or v and move · [ ] to a code block or quote, then y copies it · Y copies the whole note"); return true; }
      if (c !== "v") return false;
      void this.runKey("select.mode", {}, host);
      return true;
    }
    // `a`: the passage toolbar takes the next key (ADR 0004 contract 5); that key runs its choice on the selection.
    if (this.passageMenu) {
      this.passageMenu = false;
      const pick = this.passageChoices().find(x => x.key === c);
      if (pick) this.passagePick(pick.action, host);
      else if (k.kind !== "esc") host.ctx.flash(`a then ${this.passageChoices().filter(x => x.key).map(x => `${x.key} ${x.label.toLowerCase()}`).join(" · ")}`);
      host.redraw();
      return true;
    }
    if (c === "a" && s.text(rows).trim()) { this.passageMenu = true; host.redraw(); return true; }
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
  sourceOf(s: Selection, noteOnly = false): { text: string; exact: boolean; from: number; to: number; lines: [number, number] } | null {
    const d = this.drawn, m = this.msg, rows = this.selRows(noteOnly);
    if (!d || !m || !rows) return null;
    const lines: number[] = [];
    for (let r = s.start.row; r <= s.end.row; r++) {
      // The title's rows, wrapped (PIE-815): the subject line.
      if (r >= d.titleRows[0] && r < d.titleRows[1]) lines.push(Math.max(0, titleLine(m.text).line));
      else if (r >= d.top) { const b = d.doc.source[r - d.top], l = b === undefined ? undefined : d.lines[b]; if (l !== undefined) lines.push(l); }
    }
    if (!lines.length) return null;
    const lo = Math.min(...lines), hi = Math.max(...lines), all = m.text.split("\n");
    const start = all.slice(0, lo).reduce((n, l) => n + l.length + 1, 0);
    const span = all.slice(lo, hi + 1).join("\n");
    const seen = s.text(rows);
    // The `{{ }}` on these lines are drawn as their values (refs.ts presentLinks): a selection of those words is the whole token.
    const answer = isOutlineNote(m) ? siteAnswerOf(m.id, m.text, this.src) : null;
    const values = answer ? pairValues(m.text, answer.values).flatMap(p => p.value && p.start >= start && p.end <= start + span.length ? [{ start: p.start - start, end: p.end - start, words: readerWords(m.text.slice(p.start, p.end), p.value) }] : []) : [];
    // Words that are on these lines more than once: the same one as drawn, counted from where the lines start drawing.
    let r0 = s.start.row;
    const lineOfRow = (r: number) => (r >= d.titleRows[0] && r < d.titleRows[1] ? Math.max(0, titleLine(m.text).line) : r >= d.top ? d.lines[d.doc.source[r - d.top] ?? -1] : undefined);
    while (r0 > d.top && lineOfRow(r0 - 1) === lo) r0--;
    const before = s.start.col > (rows.margin?.(s.start.row) ?? 0) || r0 < s.start.row
      ? new Selection({ row: r0, col: rows.margin?.(r0) ?? 0 }, { row: s.start.row, col: s.start.col - 1 }).text(rows) : "";
    const nth = (t: string, inText: string) => { let n = 0; for (let i = inText.indexOf(t); i >= 0; i = inText.indexOf(t, i + 1)) n++; return n; };
    // A wrapped paragraph reads with a space where the reader broke it.
    for (const t of [seen, seen.replace(/\n/g, " ")]) {
      if (!t.trim()) continue;
      const k = nth(t, before.replace(/\n/g, " ") + t.slice(0, -1));
      // A value is drawn as its words, not its source: the selection that touches one is read from the drawing (source-map.ts).
      if (values.length) {
        const hit = sourceSpanOf(span, t, values, k);
        if (hit) return { text: span.slice(hit.from, hit.to), exact: true, from: start + hit.from, to: start + hit.to, lines: [lo, hi] };
      }
      let at = -1;
      for (let i = 0, j = span.indexOf(t); j >= 0; i++, j = span.indexOf(t, j + 1)) if (i === k) { at = j; break; }
      if (at >= 0) return { text: t, exact: true, from: start + at, to: start + at + t.length, lines: [lo, hi] };
    }
    // Drawn words with a link, emphasis or a list mark inside: read the source lines as they're drawn (source-map.ts).
    for (const t of [seen, seen.replace(/^[ \t]*[•◦▪▸‣·○●☐☑✓✗□■-][ \t]+/gm, "")]) {
      const hit = sourceSpanOf(span, t, values);
      if (hit) return { text: span.slice(hit.from, hit.to), exact: true, from: start + hit.from, to: start + hit.to, lines: [lo, hi] };
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
  selectBy({ text, line, to, n, noteOnly = false }: { text?: string; line?: number; to?: number; n?: number; noteOnly?: boolean }): Selection {
    const d = this.drawn, rows = this.selRows(noteOnly);
    if (!d || !rows || !this.msg) throw new ActionRefused("this reader doesn't show the note's text now (it's editing, commenting, reading the note, or the full property panel is open)");
    if ((text === undefined) === (line === undefined)) throw new ActionRefused("say what to select: text= (as the note reads) or line= (with to= for a range; 1 is the subject)");
    if (text !== undefined) {
      return selectText(rows, text, n, noteOnly);
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

  // ── the passage target (ADR 0004 contract 5) and the margin (contract 6) ──────────

  /**
   * The passage an action acts on, for `actor`: the words it names (`quote`, `near` among repeats) in the note's
   * current text, else its own selection (the person's for the person, an agent's own for an agent: never the
   * person's). `target` is the passage as the service takes it (a Resource's text has its own offsets); `note` the same
   * words as offsets into the note shown, for a comment. Refused with why: a selection that doesn't read the same in
   * the source is never widened to its lines here.
   */
  passageFor(actor: Actor, quote?: string, near?: number): { target: PassageTarget; note: CommentPassage } {
    const m = this.msg;
    if (!m || m.revision === undefined) throw new ActionRefused("no note here to act on a passage of");
    if (m.resource?.uncommentable) throw new ActionRefused(m.resource.uncommentable);
    let from: number, to: number;
    if (quote !== undefined) {
      const at = findPassage(m.text, quote, near === undefined ? {} : { near });
      if (isMiss(at)) throw new ActionRefused(missMessage(at));
      ({ start: from, end: to } = at);
    } else {
      const sel = actor.kind === "user" ? this.selection : this.agentSelection?.id === actor.id ? this.agentSelection.sel : null;
      if (!sel) throw new ActionRefused(actor.kind === "user" ? "nothing is selected: drag across the words, or v and move" : "name the words: quote= (near= among repeats); the person's selection is theirs");
      const src = this.sourceOf(sel);
      if (!src) throw new ActionRefused("only the header's details are selected: select words of the note");
      if (!src.exact) throw new ActionRefused("the selection doesn't read the same in the note's source (a link drawn by its title, or a figure): select the words around it, or name them with quote=");
      ({ from, to } = src);
    }
    const trimmed = m.text.slice(from, to), lead = trimmed.length - trimmed.trimStart().length;
    from += lead; to = from + trimmed.trim().length;
    if (to <= from) throw new ActionRefused("only blanks are selected");
    const note = passageAt(m.text, from, to, m.id, m.revision);
    if (!m.resource) return { target: note, note: { quote: note.quote, start: from, prefix: note.prefix, suffix: note.suffix } };
    const at = m.resource.sourceAt;
    if (at === null || from < at) throw new ActionRefused("this Resource isn't drawn as its text here, so a passage of it can't be placed: open it as a file");
    const text = m.text.slice(at);
    return { target: passageAt(text, from - at, to - at, `resource:${m.resource.id}`, m.revision), note: { quote: note.quote, start: from } };
  }

  /**
   * The person's pick on the passage toolbar (its key after `a`, or a click on its chip): Comment and Ask open the
   * comment on the selection as C does (their session, entered as it opens), already writing (Ask with `@agent`);
   * the rest run passage.act at once.
   */
  private passagePick(action: string, host: SurfaceHost) {
    if (action === "sources") { void this.runKey("sources.at", {}, host); return; }
    const agent = threadAgents()[0];
    if ((action === "comment" || (action === "ask" && agent)) && host.startSession && this.selection) {
      try { this.passageFor(USER); } catch (e) { host.ctx.flash(e instanceof Error ? e.message : String(e), undefined, errorDetails(e)); return; }
      this.writeNext = { props: action === "ask" ? { kind: "question" } : null, text: action === "ask" ? `@${agent!.name} ` : "" };
      host.startSession("select");
      return;
    }
    void this.runKey("passage.act", { action }, host);
  }

  /** The columns a side margin wants beside the measured text: room for cards when the note has them, else none. */
  marginBeside(): number {
    const m = this.msg;
    // An edit or the thread list covers the note; a comment written at its passage (PIE-770) keeps the margin as it was.
    if (!m || this.marginMode === "off" || this.modes.covers || this.printed) return 0;
    const cards = (this.commentsFor === m.id ? this.comments ?? [] : []).some(c => (c.start !== null || isWholeNote(c)) && hasCard(c));
    return cards ? MARGIN_RESERVE : 0;
  }

  /** What the passage toolbar offers: Comment, Ask and Explain (with an agent that answers in threads), and each extension's passage action. */
  passageChoices(): PassageChoice[] {
    const own: PassageChoice[] = [{ action: "comment", label: "Comment", key: "c" }];
    if (threadAgents().length) own.push({ action: "ask", label: "Ask", key: "a" }, { action: "explain", label: "Explain", key: "e" });
    // Selected words in a generated region: where they come from (PIE-956 S6b), the one way in from the words themselves. Before the extensions', so no extension's key takes `w`.
    if (this.selectionInRegion()) own.push({ action: "sources", label: "Where from", key: "w" });
    const taken = new Set(own.map(c => c.key));
    for (const { action } of passageActions()) {
      const k = action.key && [...action.key].length === 1 && !taken.has(action.key) ? action.key : undefined;
      if (k) taken.add(k);
      own.push({ action: action.name, label: action.label, ...(k ? { key: k } : {}) });
    }
    return own;
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
  run(name: string, args: Record<string, unknown>, host: SurfaceHost, actor: Actor, standing: boolean, typed = false): Promise<unknown> {
    this.use(host);
    // The property panel is the person's (only their `i` opens it); an agent doesn't start an edit or a
    // comment under it, where the panel would take the keys meant for the agent's session (the mode stack's own rule).
    // A state rule, not a guard yolo lifts (the panel would take the keys meant for the agent's session); the person's
    // press's run is theirs (PIE-1186).
    if (actor.kind === "agent" && !INVITES.covers(actor.invitation, "tile", actor.run) && this.sessionMode()?.name === "panel" && STARTS_SESSION.has(name))
      return Promise.reject(new ActionRefused("the person has the property panel open on this note; try again once they close it"));
    const h: SurfaceHost = actor.kind === "agent" ? { ...host, ctx: asActor(host.ctx, actor), redraw: () => host.redraw(), navigate: (m, how) => host.navigate(m, { ...how, by: actor, standing }),
      ...(host.query ? { query: (q: string, how?: OpenHow) => host.query!(q, { ...how, by: actor, standing }) } : {}),
      ...(host.tag ? { tag: (t: string, how?: OpenHow) => host.tag!(t, { ...how, by: actor, standing }) } : {}), startSession: standing ? host.startSession : undefined, actor } : host;
    try { return Promise.resolve(typed ? NOTE_ACTIONS.run(name as never, args as never, { surface: this, host: h, standing }, actor) : NOTE_ACTIONS.runUntyped(name, args, { surface: this, host: h, standing }, actor)); }
    catch (e) { return Promise.reject(e); }
  }

  /**
   * The person's key that starts an edit, a comment or the property panel (e, ctrl+e, C, m, i, I), as the note
   * action it is (PIE-510), with `still` the host's say once the note is read. A refusal rejects, for the host
   * to say or let go (one the action said already, or the person moved on).
   */
  startAsPerson(kind: SessionKind, host: SurfaceHost, still?: () => boolean): Promise<unknown> {
    // C is a comment on the words selected (and on what a toolbar asked for), else on the whole note (PIE-846): one way
    // in, never the passage picker.
    const a = SESSION_ACTIONS[kind === "comment" ? (!this.selection && !this.writeNext && !this.session && !this.draft ? "note" : "select") : kind];
    return this.act(a.name, a.args, still ? { ...host, still } : host, USER);
  }

  /** What the surface is doing, for `peek`. */
  describe() {
    return {
      showing: this.msg ? { id: this.msg.id, title: subject(this.msg), revision: this.msg.revision } : null,
      threadDrawer: this.replyLinks?.describe() ?? null,
      editing: (this.modes.get("draft") as DraftMode | null)?.describe(),
      commenting: (this.modes.get("comment") as CommentMode | null)?.describe(),
      comments: this.comments ? { open: this.comments.filter(c => c.open).length, total: this.comments.length, threads: this.comments.map(c => ({ id: c.id, open: c.open, author: c.author, quote: c.quote, replies: c.replies.length, expanded: this.threadShown(c.id), ...(c.quotedIn?.length ? { quotedIn: c.quotedIn } : {}) })) } : null,
      links: this.links.map((l, i) => ({ n: i + 1, ...l, reads: printable(linkText(l, this.msg?.text ?? "", this.src)), selected: i === this.link })),
      summary: this.msg ? (({ keys, source, text }) => ({ keys, source, text }))(this.summary(this.msg)) : null,
      folds: this.msg && !this.msg.partial ? this.describeFolds(this.msg) : null,
      elements: this.drawn || this.digesting ? { count: this.elems.length, current: this.describeElements().find(e => e.current) ?? null } : null,
      focus: this.focusMark ? { by: whoOf(this.focusMark.by), marked: this.focusMark.label, ...this.focusMark.spec } : null,
      // The look it was drawn with (PIE-673): reported here, never put into the text it reads back.
      look: this.lastLook ? { breakpoint: this.lastLook.breakpoint, width: this.lastLook.width, ...Object.fromEntries((["measure", "pad.x", "pad.y", "margin.x", "margin.y", "list.gap", "list.zebra", "list.zebra.bg", "list.zebra.strength", "list.divider", "list.divider.glyph", "list.divider.align", "bg", "bg.strength", "border", "edge", "tone", "header.bg", "header.bg.opacity", "header.rule", "header.rule.tone"] as const).map(t => [t, this.lastLook!.values[t]])) } : null,
      properties: (this.modes.get("panel") as PanelMode | null)?.describe() ?? null,
      sources: this.sourcesMode?.describe() ?? null,
      listPreview: this.previewPoint() ? { selected: this.previewPoint()!.text, place: this.listPreview.place, top: this.listPreview.top } : null,
      selection: this.describeSelection(this.selection),
      agentSelection: this.agentSelection ? { id: this.agentSelection.id, ...this.describeSelection(this.agentSelection.sel) } : null,
      history: this.describeHistory(),
      ...(this.zoom ? { zoom: { kind: this.zoom.kind, label: this.zoom.label, lines: [this.zoom.start + 1, this.zoom.end + 1], ...(this.zoom.anchor ? { anchor: this.zoom.anchor } : {}) } } : {}),
      steps: this.drawn || this.digesting ? { drawn: this.elems.filter(e => e.kind === "task").length, undo: this.stepHistory.size, choosing: (this.modes.get("picker") as PickerMode | null)?.describe() ?? null } : null,
      // What the rules draw on the note (PIE-600), and whether the person has it raw (R).
      decorations: this.msg && isOutlineNote(this.msg) ? { raw: this.raw, drawn: decorationsOf(this.msg, this.src).map(d => ({ rule: d.name, place: d.place, status: d.status, on: d.hit.at, line: d.hit.line })) } : null,
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
    this.agent = { id: actor.id, did: fullPlainText(did), at: Date.now() };
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
  /** Notes whose old edits the person unfolded ([show] on the "1 old edit" chip). */
  private oldUnsentShown = new Set<string>();
  /** Unfold the old edits on note `of` (`unsent.show`). */
  showOldUnsent(of: string) { this.oldUnsentShown.add(of); }
  /** The text an edit kept without its own starting text began from, read from the note's history, by edit (null: not kept; absent: being read). */
  private unsentBases = new Map<string, string | null>();
  private unsentBaseKey = (id: string, u: Unsent) => `${id}@${u.base}@${u.at}`;
  /** What was settled quietly on the note shown (an edit the note already had), said once in a dim line. */
  private settled: { id: string; copy: string; day: string } | null = null;

  /** An edit kept on the note shown: settle it quietly when the note already has all of it, else read its starting text if it needs the history. */
  private settleUnsent(m: Msg, host: SurfaceHost) {
    const u = unsent(`edit:${m.id}`);
    if (!u || m.partial || !isOutlineNote(m)) return;
    const board = host.ctx.board;
    void settleQuietly(m, board).then(done => {
      if (this.msg?.id !== m.id) return;
      if (done) { this.settled = { id: m.id, copy: done.copy, day: done.day }; host.redraw(); return; }
      const key = this.unsentBaseKey(m.id, u);
      if (u.from !== undefined || this.unsentBases.has(key)) return;
      void baseTextOf(u, m.id, m, board).then(text => { this.unsentBases.set(key, text); if (this.msg?.id === m.id) host.redraw(); });
    }, () => {});
  }

  /**
   * The lines for what's kept on note `m` (or, in a view of it, for the note it's about), each with its controls as
   * elements and click targets from header row `row`. The words come from the comparison with the note now
   * (src/unsent-compare.ts); old edits on an older revision fold into one dim chip until [show].
   */
  private unsentHead(m: Msg, w: number, row: number): { lines: string[]; elems: Element[] } {
    const view = unsentView(m.id), of = view?.of ?? m.id;
    const all = unsentEntries(of, m.revision, view ? { verdict: viewVerdict(of) } : { text: m.text, baseOf: u => this.unsentBases.get(this.unsentBaseKey(of, u)) });
    const folded = this.oldUnsentShown.has(of) ? [] : all.filter(e => e.old), shown = all.filter(e => !folded.includes(e));
    const tags: Link[] = [];
    const mine = (ops: UnsentOp[]) => ops.filter(op => op !== view?.view);
    const control = (e: UnsentEntry, op: UnsentOp) => " " + fg(C.lcyan) + tagged(tags, { block: of, role: "control", unsent: { of, kind: e.kind, op } }, unsentLabel(op, e.verdict));
    const controls = (e: UnsentEntry) => mine(e.ops).map(op => control(e, op)).join("");
    const labelOf = (e: UnsentEntry, op: UnsentOp) => unsentLabel(op, e.verdict);
    /** The controls on rows of their own, as many to a row as fit. */
    const controlRows = (e: UnsentEntry) => mine(e.ops).reduce<UnsentOp[][]>((rows, op) => {
      const last = rows.at(-1);
      if (last && last.reduce((n, o) => n + labelOf(e, o).length + 1, 0) + labelOf(e, op).length + 1 <= w) last.push(op); else rows.push([op]);
      return rows;
    }, []).map(r => pad(r.map(op => control(e, op)).join(""), w) + RESET);
    // Its controls after the words when both fit, else on rows of their own under them (a narrow reader).
    const wide = (e: UnsentEntry) => mine(e.ops).reduce((n, op) => n + labelOf(e, op).length + 1, 0);
    // The chip stands for "old": a dim line, not the amber of a warning.
    const chip = { kind: "edit" as const, verdict: null, ops: ["show" as const] } as UnsentEntry;
    const raw = [
      // The words wrap, never cut: they are the answer. Its controls follow the last row when they fit, else rows of their own.
      ...shown.flatMap(e => {
        const rows = wrap(e.text, w), last = rows.pop() ?? "";
        const fits = width(last) + wide(e) <= w;
        return [...rows.map(r => pad(fg(C.grey) + r, w) + RESET), ...(fits ? [pad(fg(C.grey) + last + controls(e), w) + RESET] : [pad(fg(C.grey) + last, w) + RESET, ...controlRows(e)])];
      }),
      ...(folded.length ? [pad(fg(C.dark) + oldUnsentLine(folded.length) + " ·" + controls(chip), w) + RESET] : []),
      ...(this.settled && this.settled.id === of ? wrap(`■ ${verdictWords({ basis: "three-way", kind: "nothing-new", hunks: [] }, this.settled.day)}; kept a copy (${tidy(this.settled.copy)})`, w).map(r => pad(fg(C.dark) + r, w) + RESET) : []),
    ];
    const { lines, ranges } = extractLinks(raw);
    const elems: Element[] = ranges.map(r => {
      const l = tags[r.n]!, u = l.unsent!, key = `control:unsent:${u.op}:${u.kind}:${of}#0`, at = row + r.line;
      this.hits.push({ row: at, from: r.from, to: r.to, link: l, elem: key });
      return { key, kind: "control", row: at, from: r.from, to: r.to, ruler: [at, at + 1], label: `${unsentLabel(u.op, view ? viewVerdict(of) : null)} the kept ${u.kind === "child" ? "note" : u.kind}`, link: l };
    });
    return { lines, elems };
  }

  private proposalOperations(id: string) {
    if (this.msg?.id === id) return isOpenProposal(this.msg) ? proposalOps(this.msg) : [];
    return this.elems.flatMap(e => e.link?.proposal?.id === id && e.link.proposal.op ? [e.link.proposal.op] : []);
  }

  private proposalKeys(id: string): string {
    const keys = { apply: "A apply anyway", dismiss: "X dismiss", resolve: "r resolve" };
    return this.proposalOperations(id).map(op => keys[op] + " · ").join("");
  }

  /** The person's `A`, `X`, or a click or ⏎ on a proposal's control: `proposal.apply` or `proposal.dismiss`, its refusal flashed. */
  private proposalControl(op: "apply" | "dismiss" | "resolve", id: string | undefined, host: SurfaceHost): Promise<unknown> {
    return this.runKey(`proposal.${op}`, id ? { id } : {}, host).then(r => r ?? null);
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
    if (s.draft.written && !discard && !s.busy) throw new ActionRefused("the draft has unsaved changes; edit.save saves it, discard=true closes it anyway (put aside as unsent first, as esc twice does)");
    return this.replyParent && discard ? { closed: true, ...s.discard() } : s.close(discard);
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
      if (s.mode === "compose" && s.target && s.target.kind !== "quote") throw new ActionRefused(`${s.target.kind === "reply" ? "a reply is being written" : "a comment is being edited"} here; ${s.target.kind === "reply" ? "send" : "save"} or close it first`);
      // `c` from the thread list, or picking again while writing: the text written so far rides along.
      await s.pick(this.commentEnv(host), s.mode === "compose");
    }
    return s;
  }

  env(host: SurfaceHost, actor: Actor) { return this.commentEnv(host, actor); }
  /** Bring the comment being written into view at the next paint (comment.place). */
  revealComposerNext() { this.revealComposer = true; }
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
    this.linkUnlaid = this.cur === null && !this.elems.length ? i : null;
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
/** An image action's image, refused when it's an artifact (PIE-793): an artifact takes a size, a height and a place, nothing else. */
const notArtifact = <T extends { spec: MediaSpec }>(ref: T): T => {
  if (ref.spec.kind === "artifact") throw new ActionRefused("that's an artifact, not an image: it takes a size, a height and a place (image.size, image.align), and artifact.open runs it");
  return ref;
};
const imageControlLabel = (c: ImageControl) => "size" in c ? `size ${c.size > 0 ? "+" : "−"}` : "align" in c ? `align ${c.align > 0 ? "▸" : "◂"}` : "fit" in c ? (c.fit === "contain" ? "show it whole" : "crop it to fill") : "open" in c ? "open it on its web page" : "share" in c ? "share it with a link" : c.hero ? "make it the header" : "not the header";
/** What a line change says when its line no longer reads as drawn (`flash`, `refused`), and after a conflict (`again`). */
interface Stale { flash: string; refused: string; again: string }
const CALLOUT_STALE: Stale = { flash: "that callout changed since it was drawn · nothing was changed · choose again", refused: "that callout changed since it was drawn; nothing was changed (callout.list reads it again)", again: "choose again" };
const SOURCE_STALE: Stale = { flash: "that line changed since the sources were read · nothing was changed · read them again (r)", refused: "that line changed since the sources were read; nothing was changed", again: "read the sources again (r) and retry" };
const USE_STALE: Stale = { flash: "that ::use line changed since it was drawn · nothing was changed · press again", refused: "that ::use line changed since it was drawn; nothing was changed (use.fill reads it again)", again: "press again" };
const IMAGE_STALE: Stale = { flash: "that image's line changed since it was drawn · nothing was changed · try again", refused: "that image's line changed since it was drawn; nothing was changed (images reads it again)", again: "try again" };
/** One line of a note rewritten: its index, its text as it was read, and what it became. */
interface LineEdit { line: number; before: string; after: string }
/** A change of whole lines (a callout's header, an image's layout) for undo. */
interface LineUndo { patch?: { start: number }; block: string; edits: LineEdit[]; by: string; context: string }

/**
 * A step's status choice (PIE-472), `W` cells wide: Detail's choices in its order, each with its key, the
 * one the keys are on lit, the step's current status marked, and what the last choice said.
 */
function pickerPanel(ref: StepRef, choices: readonly Choice[], sel: number, note: string, busy: boolean, W: number): { lines: string[]; rows: number[] } {
  const edge = fg(C.yellow), inner = Math.max(8, W - 2), f = stringFrame(W, { glyphs: LINE_BOX, ink: edge, pad: 0, open: true });
  const lines = [f.top(fg(C.white) + ` ${STEP_BOXES[ref.step.status]} ${printable(stepTitle(ref.step))} `)];
  const rows: number[] = [];
  // The list's own choices (on a live row, each says what it writes): the panel draws them, never a second copy.
  choices.forEach((c, i) => {
    const now = (c.id === ref.step.status ? " · now" : "");
    const text = pad(` ${c.label}${now}`, Math.max(1, inner - 3)) + ` ${c.key} `;
    rows.push(lines.length);
    lines.push(f.row((i === sel ? ITEM_BG + fg(C.white) : fg(C.lcyan)) + pad(text, inner)));
  });
  if (note) lines.push(f.row(fg(busy ? C.dark : C.lred) + pad(` ${printable(note)}`, inner)));
  const foot = ` ⏎ choose · esc cancel${ref.via ? ` · in ${ref.via}` : ""} `;
  lines.push(f.bottom(fg(C.dark) + foot));
  return { lines, rows };
}

/**
 * A callout's type choice (PIE-538), `W` cells wide: the outline's types (the one list, src/callouts.ts), each with its
 * icon in its tone and its other names, its type now marked; then whether it starts folded or open, the `-` or `+`.
 */
function calloutPanel(ref: CalloutRef, P: Picker, W: number): { lines: string[]; rows: number[] } {
  const edge = fg(C.yellow), inner = Math.max(8, W - 2), types = P.types!, f = stringFrame(W, { glyphs: LINE_BOX, ink: edge, pad: 0, open: true });
  const now = types.resolve(ref.type)?.name ?? ref.type;
  const lines = [f.top(fg(C.white) + ` [!${printable(ref.type)}] ${printable(calloutTitle(ref))} `)];
  // Every choice drawn, as the step choice draws its own, so each is a click away; the reader brings the panel into
  // view when it opens, and scrolls (the wheel) over a tall one.
  const items = P.list.items, rows: number[] = [];
  items.forEach((c, i) => {
    const t = c.id.startsWith("type:") ? types.resolve(c.id.slice(5)) : null;
    const on = i === P.list.sel, base = on ? ITEM_BG + fg(C.white) : fg(C.lcyan);
    const icon = t ? (on ? "" : fg(TONE[t.tone])) + t.icon + base + " " : "  ";
    // "now" next to the name, before the aliases a narrow reader cuts.
    const mark = t?.name === now ? " · now" : "";
    const label = t ? `${t.name}${mark}${t.aliases.length ? ` · ${t.aliases.join(", ")}` : ""}${t.block ? " · this outline's" : ""}` : c.label;
    rows.push(lines.length);
    lines.push(f.row(base + " " + icon + pad(label, Math.max(1, inner - 3 - (c.key ? 3 : 0))) + (c.key ? ` ${c.key} ` : "")));
  });
  if (P.note) lines.push(f.row(fg(P.busy ? C.dark : C.lred) + pad(` ${printable(P.note)}`, inner)));
  const foot = " ⏎ choose · - folded · + open · esc cancel ";
  lines.push(f.bottom(fg(C.dark) + foot));
  return { lines, rows };
}

/** A thread control's element key: stable across renders while its thread stays expanded. */
const controlKey = (thread: string, c: ThreadControl, value?: string) => `ctl:${thread}:${c}${value ? `:${value}` : ""}`;

/**
 * A comment thread drawn under its passage (PIE-420), `W` cells wide: who and when, open or resolved, the
 * comment and its replies, and the Select, Reply and Resolve (or Reopen) controls, the current one lit.
 * Controls' rows and columns are the panel's own (no margin).
 */
/** A draft's preview pictures as its frame last placed them (PIE-846), cut to the host's rows [`from`, `to`). */
const previewPictures = (d: Draft, from: number, to: number): Placement[] =>
  d.preview ? (d.frame?.preview?.placements ?? []).flatMap(p => inWindow(p, from, to - from, from) ?? []) : [];

/** The byline's way in to a comment on the whole note (PIE-846). */
const COMMENT_CHIP = "[comment]";
/** The header's quiet way into the Sources inspector, on a note that generates anything (PIE-956 S6b). */
const SOURCES_CHIP = "[sources]";

/** A thread on the whole note (PIE-846): no passage was ever quoted (one whose quoted words moved still has its quote). */
export const isWholeNote = (c: Pick<Comment, "start" | "quote">) => c.start === null && !c.quote;

function threadPanel(c: Comment, W: number, cur: string | null, drawDoc?: (text: string, width: number) => string[] | { lines: string[]; images?: DocImage[]; links?: LinkRange[] }, trim = false): { lines: string[]; bg: string; controls: Control[]; images: DocImage[]; links: LinkRange[] } {
  // Its pictures (PIE-846), on the panel's own rows: `col` cells in from the panel's left.
  const images: DocImage[] = [];
  const links: LinkRange[] = [];
  const draw = drawDoc && ((text: string, w: number, col = 2, interactive = true): string[] => {
    const r = drawDoc(text, w);
    if (Array.isArray(r)) return r;
    if (interactive) for (const l of r.links ?? []) links.push({ ...l, line: lines.length + l.line, from: col + l.from, to: col + l.to });
    for (const im of r.images ?? []) images.push({ ...im, line: lines.length + im.line, col: col + im.col });
    return r.lines;
  });
  const edge = fg(c.open ? C.yellow : C.dark), bg = cardBg(c.props);
  const inner = Math.max(4, W - 2);
  const n = c.replies.length;
  const title = ` ${kindOf(c)} · ${c.open ? "■" : "·"} ${printable(authorName(c.author))} · ${ago(c.at)}${editedMark(c)} · ${c.lifecycle}${n ? ` · ${n} repl${n === 1 ? "y" : "ies"}` : ""} `;
  const f = stringFrame(W, { glyphs: LINE_BOX, ink: edge, open: true });
  const lines = [f.top(fg(c.open ? C.white : C.grey) + title, fg(C.lcyan) + "[–]")];
  const text = (s: string, w: number) => printable(s.replace(/\t/g, " "), "", { lines: true }).split("\n").flatMap(l => (l ? wrap(l, w) : [""]));
  // The body and replies as the reader draws a note (PIE-770): references by title, embeds transcluded; else as typed.
  const body = (s: string, w: number, col = 2) => (draw ? draw(s, w, col) : text(s, w));
  if (trim) {
    const summary = c.tldr ? `TL;DR ${c.tldr.body}` : c.replies.at(-1)?.body ?? c.body;
    lines.push(edge + "│ " + fg(C.grey) + drawEllipsized(body(summary, inner).join(" "), inner) + RESET);
    return { lines: lines.map(l => onCard(l, W, bg)), bg, images: [], links: [], controls: [
      { thread: c.id, control: "toggle", row: 0, from: W - 3, to: W, label: "Fold thread" },
      { thread: c.id, control: "card", row: 0, from: 0, to: W - 3, label: "Open thread" },
      { thread: c.id, control: "card", row: 1, from: 0, to: W, label: "Open thread" },
    ] };
  }
  // Its TL;DR first: the thread's face, the discussion under it.
  if (c.tldr) for (const l of body(`TL;DR ${c.tldr.body}`, inner)) lines.push(edge + "│ " + fg(C.lgreen) + l + RESET);
  for (const l of body(c.body, inner)) lines.push(edge + "│ " + fg(c.open ? C.white : C.grey) + l + RESET);
  if (c.start === null && c.quote) lines.push(edge + "│ " + fg(C.brown) + "(the quoted words moved; the service couldn't place them)" + RESET);
  const controls: Control[] = [{ thread: c.id, control: "toggle", row: 0, from: W - 3, to: W, label: "Fold thread" }];
  // Where a mark was quoted (quote): a line each, opening the block that quotes it.
  const quotedIn = (ids: readonly string[] | undefined, indent: string) => {
    for (const id of ids ?? []) {
      const said = `quoted in ${draw ? (draw(`((${id}))`, Math.max(4, inner - 12), 2, false)[0] ?? "") : id.slice(0, 8)}`;
      const shown = drawEllipsized(said, Math.max(4, inner - indent.length));
      const on = cur === controlKey(c.id, "quoted", id);
      controls.push({ thread: c.id, control: "quoted", value: id, row: lines.length, from: 2 + indent.length, to: 2 + indent.length + width(shown), label: "quoted in" });
      lines.push(edge + "│ " + indent + (on ? ITEM_BG + fg(C.white) : fg(C.lcyan)) + shown + RESET);
    }
  };
  quotedIn(c.quotedIn, "");
  // A TL;DR is shown once, as the face above (PIE-860): its reply (and any it replaced) isn't listed again under it.
  for (const r of c.replies.filter(x => !x.tldr)) {
    // Each reply is a mark too: its own [Quote].
    // Each reply is a mark too: its own [Edit] (PIE-763) and [Quote].
    const stamp = " · " + ago(r.at) + editedMark(r);
    const head = "└ " + drawEllipsized(printable(authorName(r.author)), Math.max(1, inner - 2 - width(stamp))) + stamp;
    let row = edge + "│ " + fg(C.cyan) + drawEllipsized(head, inner) + RESET, col = 2 + Math.min(width(head), inner);
    for (const [k, q, label] of [["edit", "[Edit]", "Edit the reply"], ["quote", "[Quote]", "Quote the reply"]] as const) {
      if (col + 1 + q.length > W) { lines.push(row); row = edge + "│ "; col = 2; }
      controls.push({ thread: c.id, control: k, value: r.id, row: lines.length, from: col + 1, to: col + 1 + q.length, label });
      row += " " + (cur === controlKey(c.id, k, r.id) ? ITEM_BG + fg(C.white) : fg(C.lcyan)) + q + RESET;
      col += 1 + q.length;
    }
    lines.push(row);
    for (const l of body(r.body, Math.max(2, inner - 2), 4)) lines.push(edge + "│ " + fg(C.cyan) + "  " + RESET + l + RESET);
    quotedIn(r.quotedIn, "  ");
  }
  // The controls on one row, or as many as a narrow reader needs: each is whole, never cut off.
  let row = edge + "│ ", col = 2;
  // A thread on the whole note has no words to select (PIE-846).
  // With a TL;DR: edit it, ask for it again, or take it away (PIE-860).
  const all: [ThreadControl, string, string?][] = [
    ...(isWholeNote(c) ? [] : [["select", "Select"] as [ThreadControl, string]]), ["reply", "Reply"], ...(c.body.trim() ? [["edit", "Edit"] as [ThreadControl, string]] : []),
    ["seen", c.open ? "Seen" : "Bring back"], ["keep", c.lifecycle === "kept" ? "Unkeep" : "Keep"],
    ...(c.tldr ? [["edit", "Edit TL;DR", c.tldr.id], ["tldr", "TL;DR again"], ["untldr", "No TL;DR"]] as [ThreadControl, string, string?][] : [["tldr", "TL;DR"] as [ThreadControl, string]]),
    ["quote", "Quote"],
  ];
  all.forEach(([k, label, value]) => {
    const shown = `[${label}]`, on = cur === controlKey(c.id, k, value);
    if (col > 2 && col + 3 + shown.length > W) { lines.push(row + RESET); row = edge + "│ "; col = 2; }
    if (col > 2) { row += fg(C.dark) + " · "; col += 3; }
    row += on ? ITEM_BG + fg(C.white) + shown + RESET : buttonText(label);
    controls.push({ thread: c.id, control: k, row: lines.length, from: col, to: col + shown.length, label, ...(value ? { value } : {}) });
    col += shown.length;
  });
  lines.push(row + RESET, f.bottom());
  return { lines: lines.map(l => onCard(l, W, bg)), bg, controls, images, links };
}

/**
 * `doc` with rows put in: each insert's `lines` before body row `at` (in order, for the same `at`), drawn
 * from no note line (source -1), so selection, focus and fold lookups pass over them. Links, images,
 * media rows and fold heads move down with the rows under them. `starts[i]`: where insert i landed.
 */
/** `doc` with `inserts`' rows put in at their rows (a thread's panel, a comment's box); an insert's `images` (on its own rows) go with it. */
function withRows(doc: Doc, inserts: readonly { at: number; lines: readonly string[]; images?: readonly DocImage[]; links?: readonly LinkRange[] }[]): { doc: Doc; starts: number[] } {
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
      links: [...doc.links.map(l => ({ ...l, line: mv(l.line) })), ...inserts.flatMap((p, i) => (p.links ?? []).map(l => ({ ...l, line: starts[i]! + l.line })))],
      images: [...doc.images.map(im => ({ ...im, line: mv(im.line) })), ...inserts.flatMap((p, i) => (p.images ?? []).map(im => ({ ...im, line: starts[i]! + im.line })))],
      media: doc.media.map(x => ({ ...x, row: mv(x.row) })),
      heads: doc.heads.map(h => ({ ...h, row: mv(h.row), ...(h.rows ? { rows: mv(h.row + h.rows - 1) + 1 - mv(h.row) } : {}) })),
      ...(doc.regions ? { regions: doc.regions.map(r => ({ ...r, row: mv(r.row), rows: mv(r.row + r.rows - 1) + 1 - mv(r.row) })) } : {}),
      trims: new Map([...doc.trims].map(([r, t]) => [mv(r), t])),
      // A block that rows were put inside (a thread under a quote's passage) grows with them.
      blocks: [
        ...doc.blocks.map(b => ({ ...b, row: mv(b.row), rows: mv(b.row + b.rows - 1) + 1 - mv(b.row), ...(b.cells ? { cells: b.cells.map(c => ({ ...c, row: mv(c.row) })) } : {}) })),
        ...inserts.flatMap((p, i) => codeSpans(p.lines, p.lines.map(() => -1)).map(b => ({
          ...b, row: starts[i]! + b.row, cells: b.cells!.map(c => ({ ...c, row: starts[i]! + c.row })),
        }))),
      ],
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
  // The one quote lookup (outline-core passage.ts): the first place, or the one nearest `near`.
  const at = quote ? findPassage(text, quote, { near: near ?? 0 }) : null;
  return !at || isMiss(at) ? -1 : at.start;
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



/** A draft action (src/edit.ts, DRAFT_ACTIONS) run on the reader's edit or comment being written. */
function forwardDraft<K extends keyof DraftActionArgs>(name: K): ActionDef<DraftActionArgs[K], On> {
  const info = DRAFT_ACTIONS.list().find(a => a.name === name)!, def = DRAFT_ACTIONS.def(name)!;
  return {
    summary: `${info.summary} (in this reader's edit or comment)`, keys: info.keys,
    touches: def.touches, ...(def.draft ? { draft: def.draft } : {}), replay: def.replay,
    args: info.args as ActionDef<DraftActionArgs[K], On>["args"],
    ...(def.examples ? { examples: def.examples } : {}),
    // Who an argument makes it the person's own for, as the draft's own action says (draft.undo past=true).
    ...(def.personWith ? { personWith: def.personWith as ActionDef<DraftActionArgs[K], On>["personWith"] } : {}),
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

/** The terminal's own background: a picture under the text shows through a cell on it in every terminal. */
const DEFAULT_BG = "\x1b[49m";
/** `lines` with the cells under each of `placements` on the terminal's own background (PIE-839), in place. */
function onGround(lines: string[], placements: readonly Placement[]): void {
  for (const p of placements) for (let r = Math.max(0, p.row); r < p.row + p.rows && r < lines.length; r++) lines[r] = paintRange(lines[r]!, p.col, p.col + p.cols, DEFAULT_BG);
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
    const png = sized(im.media, im.cols * cellW, im.rows * cellH, { ...im.look, ...(im.dim !== undefined ? { dim: im.dim } : {}), ...(im.crop ? { crop: im.crop } : {}) });
    if (!png) return [];
    // The part it was dimmed for (another crop's, while a resize goes on: src/media.ts sized).
    const c = png.crop;
    const crop = c ? { x: Math.round(c.x * png.width), y: Math.round(c.y * png.height), w: Math.max(1, Math.round(c.w * png.width)), h: Math.max(1, Math.round(c.h * png.height)) } : undefined;
    return [{ key: `img:${png.key}:${im.line}`, image: png, col: col + im.col, row: im.line, cols: im.cols, rows: im.rows, z: -1, ...(crop ? { crop } : {}) }];
  });


/**
 * A draft's live preview where no note is open (PIE-496): the reader's own body renderer, with embeds when its outline is available. An
 * edit's or a comment's preview on a note is `NoteSurface.snippetDoc`, its embeds expanded (PIE-852).
 */
export function draftPreview(text: string, w: number, src: Source | null = null): string[] { return draftPreviewDoc(text, w, src).lines; }
/** `draftPreview` with where its links are drawn (PIE-592): their targets land in `links`, by `.links`' `n`. */
export function draftPreviewDoc(text: string, w: number, src: Source | null = null, links: LinkTarget[] = []): Doc & { pending: boolean } {
  return NoteSurface.draftPreviewDoc(text, w, src, links);
}

/** The proposal `proposal.apply` or `proposal.dismiss` acts on: `id`, else the one whose embed or control is the current element, else the open proposal shown. */
function proposalTarget(id: string | undefined, surface?: NoteSurface): string {
  const shown = surface?.msg && isOpenProposal(surface.msg) ? surface.msg.id : undefined;
  const target = id ?? surface?.currentProposal() ?? shown;
  if (!target) throw new ActionRefused("say which proposal: id=, or put [ ] on a proposal's embed");
  return target;
}

/** What a reader showing a trashed note says under its header (the river's column says it too). */
export const IN_TRASH = "■ in the Trash · still readable here";
/** How many open constructs a reader says by name above the note; the rest are counted. */
const OPEN_SHOWN = 3;
/** `syntaxWarnings` of the text last drawn: a reader draws one note many times between edits. */
let openSeen: { text: string; open: ReturnType<typeof syntaxWarnings> } = { text: "", open: [] };
function openConstructs(text: string): ReturnType<typeof syntaxWarnings> {
  if (openSeen.text !== text) openSeen = { text, open: syntaxWarnings(text) };
  return openSeen.open;
}


// ── the actions ──────────────────────────────────────────────────────────────

interface On { surface: NoteSurface; host: SurfaceHost; standing: boolean }

/**
 * A note action's row in its reader's menu (tile.menu, PIE-492): under "Note", hidden while the reader shows no note,
 * and dimmed (`busy`) while an edit or a comment holds it.
 */
/** An unsent action's argument: which put-aside draft on the note. */
/** back and forward's `steps`: how many stops on the trail at once. */
const STEPS_ARG = { type: "number" as const, optional: true as const, about: "how many stops at once (default 1): trail lists them" };
const UNSENT_ARGS = { kind: { type: "string" as const, optional: true, about: "edit (default), comment, child (a note under this one) or card: what's put aside on the note" } };
/** The note what's put aside belongs to: the note shown, or the one a diff or copy view is about. */
const unsentOf = (surface: NoteSurface) => { const m = surface.requireNote(); return unsentView(m.id)?.of ?? m.id; };
/** The first kind put aside on the note shown (what [open copy] and [dismiss] mean without kind=). */
const firstUnsent = (surface: NoteSurface): UnsentKind | undefined => { const m = surface.msg; if (!m) return undefined; const of = unsentView(m.id)?.of ?? m.id; return (["edit", "comment", "child", "card"] as const).find(k => unsent(`${k}:${of}`)); };
/** What's put aside on the note shown, as `kind`, refused when there's nothing; `fetch`: the note as it is now too. */
async function unsentHere(surface: NoteSurface, host: SurfaceHost, kind: string, fetch: boolean): Promise<{ of: string; u: Unsent; now: Msg | null }> {
  if (!["edit", "comment", "child", "card"].includes(kind)) throw new ActionRefused(`kind is edit, comment, child or card, not ${kind}`);
  const of = unsentOf(surface), u = unsent(`${kind}:${of}`);
  if (!u) throw new ActionRefused(`nothing is kept here (${kind})`);
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

/** What each tile= a draft's buttons name answered (`tile.info`'s refusal, or null), per edit (PIE-1312). */
const BUTTON_TILES = new WeakMap<Draft, Map<string, string | null | undefined>>();

/**
 * The tile `sel` names, as `tile=` reads it wherever the door runs a tile action (the screen shown, its mounts, the drawer):
 * its id, or the refusal's words (the resolver's reason and what to type). Asked through `tile.info`, the one owner.
 */
async function tileNamed(host: SurfaceHost, sel: string, actor: Actor): Promise<{ id: string } | { why: string }> {
  const d = (host.ctx as { dispatch?: import("./dispatch").Dispatcher }).dispatch;
  if (!d) return { why: "this screen has no tiles" };
  try {
    const r = await d.act({ action: "tile.info", tile: sel }, actor) as { tile?: string };
    return r?.tile ? { id: r.tile } : { why: `${sel} names no tile` };
  } catch (e) { if (e instanceof ActionRefused) return { why: e.message }; throw e; }
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

/**
 * A key that starts a session in a reader: e edit, ctrl+e $EDITOR, C comment (on the words selected, else the whole
 * note: PIE-846), m threads, i / I properties; `select` is the passage picker (`passage.select`, an agent's or `act`'s)
 * and `note` a comment on the whole note (`comment.note`), as C resolves them.
 */
export type SessionKind = "note-thread" | "note-reply" | "edit" | "external" | "comment" | "select" | "note" | "threads" | "props" | "props-full";
/** The key that starts a session in a reader (e, ctrl+e, C, m, i, I; c collapses), or null: one table for every reader. */
export function sessionStart(k: Key): SessionKind | null {
  if (k.kind !== "char") return null;
  if (k.ctrl) return k.ch === "e" ? "external" : null;
  return k.ch === "t" ? "note-thread" : k.ch === "R" ? "note-reply" : k.ch === "e" ? "edit" : k.ch === "C" ? "comment" : k.ch === "m" ? "threads" : k.ch === "i" ? "props" : k.ch === "I" ? "props-full" : null;
}
/** The person's e and ctrl+e arm the edit (edit.arm, src/arm.ts) where the others start at once; a click on a hint's e opens it. */
export const armsEdit = (kind: SessionKind): boolean => (kind === "edit" || kind === "external") && !clickedKey();
/** The key running now came from a click (a hint's key: asBoundKey "click"): the mouse's, so an edit opens at once. */
const clickedKey = () => !!boundNow()?.split("; ").includes("click");
/** The note action each of those keys runs (PIE-510): the key, a click and `act` all start it the same way. */
export const SESSION_ACTIONS: Record<SessionKind, { name: "note.thread" | "note.reply" | "edit" | "passage.select" | "comment.note" | "threads" | "props"; args: Record<string, unknown> }> = {
  "note-thread": { name: "note.thread", args: {} },
  "note-reply": { name: "note.reply", args: {} },
  edit: { name: "edit", args: {} },
  external: { name: "edit", args: { external: true } },
  comment: { name: "passage.select", args: {} },
  select: { name: "passage.select", args: {} },
  note: { name: "comment.note", args: {} },
  threads: { name: "threads", args: {} },
  props: { name: "props", args: {} },
  "props-full": { name: "props", args: { full: true } },
};

/** Each action's arguments. */
export type NoteActionArgs = ArgsOfSet<typeof NOTE_ACTIONS>;
type ListActionName = keyof ArgsOfSet<typeof LISTVIEW_ACTIONS> & string;

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
    n: points.indexOf(p) + 1, kind: p.kind, text: p.text, line: lines[p.line]! + 1, hidden: p.hidden, folded: surface.effectiveFolded(p),
    foldedNow: points.filter(q => surface.effectiveFolded(q)).map(foldLabel),
  };
}

/** fold, unfold: one fold point, or with all=true every outermost one (fold) or all of them (unfold). */
async function runFold(on: boolean, { all, ...which }: FoldArgs & { all?: boolean }, { surface, host, standing }: On, actor: Actor) {
  const now = surface.msg && !surface.msg.partial ? surface.msg : null;
  if (all) {
    if (Object.values(which).some(x => x !== undefined)) throw new ActionRefused("all=true folds or unfolds every one; leave out text, line and n");
    const m = now ?? await surface.whole();
    const changed = surface.foldAll(on, standing);
    surface.noteAgent(actor, on ? "folded the note's sections" : "unfolded the whole note");
    if (standing) host.ctx.flash(changed ? `${on ? "folded" : "unfolded"} ${changed}` : "this note has no headings, nested lists or callouts to fold");
    host.redraw();
    return { changed, foldedNow: surface.foldsIn(m).points.filter(q => surface.folded.has(q.key)).map(foldLabel) };
  }
  const p = now ? foldPointIn(surface, now, which) : await foldTarget(surface, which);
  surface.setFold(p, on, standing);
  surface.noteAgent(actor, `${on ? "folded" : "unfolded"} ${foldLabel(p)}`);
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

/** A thread's lifecycle set from the thread list (PIE-791): already so says so; said on screen when an agent did it. */
async function attention(on: { surface: NoteSurface; host: SurfaceHost }, actor: Actor, thread: string, to: MarkLifecycle, said: string): Promise<Record<string, unknown>> {
  const s = await on.surface.ensureSession(on.host, "threads");
  const i = findThread(s, thread), t = s.threads[i]!;
  s.sel = i;
  if (t.lifecycle === to) { on.host.redraw(); return { already: to }; }
  await s.attend(on.surface.env(on.host, actor), to);
  if (s.error) throw new ActionRefused(s.error);
  on.surface.noteAgent(actor, said);
  return { lifecycle: to };
}

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
  surface.noteAgent(actor, kind === "reply" ? "replied to a comment" : kind === "edit" ? "edited a comment" : "commented on this note");
  return { sent: kind === "reply" ? "reply" : kind === "edit" ? "edit" : "comment", threads: s.threads.map(t => ({ id: t.id, open: t.open, quote: t.quote, replies: t.replies.length })) };
}

/**
 * back, forward (PIE-453). An agent's never moves what the person is reading: refused on the reader they have
 * focused, and where the view keeps the history (it would move their screen or focus).
 */
async function travelAction(dir: -1 | 1, { surface, host, standing }: On, actor: Actor, steps = 1) {
  const word = dir < 0 ? "back" : "forward";
  // Where the view keeps the history itself (the river's columns), it moves the person's keys: theirs alone.
  // This reader's own stops (n and p in the message reader) move only it, an agent's too.
  if (!standing && host.history && !surface.travelsHere(dir)) throw new ActionRefused(host.history.agentRefusal);
  // The person's comment unsent here: asked first (PIE-785).
  // (Synchronous when nothing is asked: the follow goes on in the same tick, as it always did.)
  const asked = surface.askLeave(word, {}, actor, host);
  if (asked) return asked;
  if (!Number.isInteger(steps) || steps < 1) throw new ActionRefused("steps is a whole number from 1 (trail lists the stops)");
  const why = await surface.travel(dir, host, actor, steps);
  if (why) throw new ActionRefused(why);
  surface.noteAgent(actor, `went ${word} here`);
  host.redraw();
  const m = surface.msg;
  return { went: word, showing: m ? { id: m.id, title: subject(m) } : null, history: surface.describeHistory() };
}

const proposalDef = def<{ id: { type: "string"; optional: true; about: string } }, { surface?: NoteSurface; host: Pick<SurfaceHost, "ctx" | "redraw"> }>;
const PROPOSAL_DEFS = {
  "proposal.resolve": def({
    summary: "ask the outline agent to resolve this proposal against the current note", keys: "r, a click on [resolve]",
    touches: "nothing", replay: "ask",
    args: { block: { type: "string", optional: true, about: "proposal block id" }, id: { type: "string", optional: true, about: "proposal block id" } },
    examples: [{ act: "proposal.resolve block=5c2e8b17-4a90-4d3f-b6e1-9f07a3d2c845", does: "resolves the intended edit against the current text" }],
    async run({ block, id }, { surface, host }: { surface?: NoteSurface; host: Pick<SurfaceHost, "ctx" | "redraw"> }, actor) {
      const target = proposalTarget(block ?? id, surface);
      host.ctx.flash("asking the agent to resolve the proposal");
      try {
        const result = await host.ctx.board.resolveProposal(target, actor);
        if (result.undo) EXT_UNDO.push({ undo: result.undo, label: "Resolve proposal", by: partyOf(actor), context: surface?.msg?.id ?? target });
        outlineChanged([target, ...(surface?.msg ? [surface.msg.id] : [])]);
        host.ctx.flash(result.undo ? `${result.message} · ctrl+z takes it back` : result.message, 8000);
        surface?.noteAgent(actor, result.outcome === "resolved" ? "resolved a proposal" : "asked to resolve a proposal");
        return result;
      } finally { host.redraw(); }
    },
  }),
  "proposal.apply": proposalDef({
    summary: "apply anyway (PIE-501): the edit an agent's draft.patch proposed when it couldn't apply, as an ordinary edit by whoever runs this; on the proposal whose embed or control is the current element, the proposal shown, or id. Refused, with why, on one whose passage was already gone when it was proposed ([proposal-applies::no]: only dismiss is offered)", keys: "A, a click on [apply]",
    touches: "nothing", replay: "ask",
    args: { id: { type: "string", optional: true, about: "the proposal block's id (default: the one whose embed or control is the current element, else the note shown)" } },
    examples: [
      { act: "proposal.apply id=5c2e8b17-4a90-4d3f-b6e1-9f07a3d2c845", does: "applies that proposed edit anyway, as an ordinary edit by whoever runs it" },
      { act: "proposal.apply", does: "applies the proposal whose control is current, else the one shown" },
    ],
    async run({ id }, { surface, host }, actor) {
      const target = proposalTarget(id, surface);
      const p = await host.ctx.board.get(target);
      if (p && isOpenProposal(p) && !proposalApplies(p)) throw new ActionRefused(NOT_APPLICABLE);
      try {
        const r = await host.ctx.board.applyProposal(target, actor);
        // Its embeds and the notes it changed are drawn again now, not when the outline's event comes.
        outlineChanged([target, ...r.edits.map(x => x.blockId)]);
        host.ctx.flash(`applied the proposal · ${r.edits.map(x => x.route === "draft" ? "into the draft being written" : "saved").join(", ")}${r.warning ? ` · but ${r.warning}` : ""}`, r.warning ? 8000 : undefined);
        surface?.noteAgent(actor, "applied a proposal anyway");
        return r;
      } catch (err) {
        throw new ActionRefused(err instanceof Error ? err.message : String(err));
      } finally { host.redraw(); }
    },
  }),
  "proposal.dismiss": proposalDef({
    summary: "dismiss a proposal (PIE-501) without applying it: the service (draft.proposal.dismiss) marks it dismissed and puts it in Trash, all recorded as whoever runs this, and the note it sits beside stops showing it (an older proposal's embed line comes out of the note, or the draft of it being written). Anyone may dismiss any proposal, an agent another agent's too, attributed", keys: "X, a click on [dismiss]",
    touches: "nothing", replay: "ask",
    args: { id: { type: "string", optional: true, about: "the proposal block's id (default: the one whose embed or control is the current element, else the note shown)" } },
    examples: [
      { act: "proposal.dismiss id=b83d4e60-2f17-4c9a-8e05-6a1c7d9f3b52", does: "dismisses that proposal without applying it, and puts it in Trash" },
      { act: "proposal.dismiss", does: "dismisses the proposal whose control is current, else the one shown" },
    ],
    async run({ id }, { surface, host }, actor) {
      const target = proposalTarget(id, surface);
      try {
        const r = await host.ctx.board.dismissProposal(target, actor);
        outlineChanged([target, ...(surface?.msg ? [surface.msg.id] : [])]);
        const line = r.embedRemoved === "saved" ? " · its embed line is out of the note" : r.embedRemoved === "draft" ? " · its embed line is out of the draft being written" : "";
        host.ctx.flash(`dismissed the proposal${line}${r.warning ? ` · but ${r.warning}` : ""}`, r.warning ? 8000 : undefined);
        surface?.noteAgent(actor, "dismissed a proposal");
        return r;
      } catch (err) {
        throw new ActionRefused(err instanceof Error ? err.message : String(err));
      } finally { host.redraw(); }
    },
  }),
};

/** The reader and a reader-free id call run the same proposal actions. */
export const PROPOSAL_ACTIONS = actionSet<{ surface?: NoteSurface; host: Pick<SurfaceHost, "ctx" | "redraw"> }>()("proposal", PROPOSAL_DEFS);

/** What `r` with no line runs: `refreshTarget`'s answer, or its refusal said on the person's status bar (the key's own is quiet). */
function refreshOf(surface: NoteSurface, host: SurfaceHost, actor: Actor): { block: string; line?: number } {
  try { return surface.refreshTarget(); } catch (e) { if (e instanceof ActionRefused && actor.kind === "user") host.ctx.flash(e.message, undefined, errorDetails(e)); throw e; }
}

const FLOAT_MOVE_ARGS = {
      dx: { type: "number", optional: true, about: "columns to move right (negative: left)" }, dy: { type: "number", optional: true, about: "rows to move down (negative: up)" },
      col: { type: "number", optional: true, about: "its left column" }, row: { type: "number", optional: true, about: "its top row" },
      dcols: { type: "number", optional: true, about: "columns wider (negative: narrower)" }, drows: { type: "number", optional: true, about: "rows taller (negative: shorter)" },
      cols: { type: "number", optional: true, about: "its width" }, rows: { type: "number", optional: true, about: "its height" },
      reset: { type: "boolean", optional: true, about: "back to its usual place and size" },
    } as const;

/** The completion list open in this reader's edit or the comment being written, or why there's none. */
function openCompleter(surface: NoteSurface): Completer {
  const d = surface.writingDraft;
  const c = d && completerOf(d);
  if (!c?.shown?.items.length) throw new ActionRefused("no completion list is open; type [[, ((, :: or a [key:: in an edit or comment first");
  return c;
}

export const NOTE_ACTIONS = actionSet<On>()("note", {
  "form.focus": def({
    summary: "fill a field in the note's form", touches: "tile", replay: "safe", person: "the person's form focus",
    args: { field: { type: "string", about: "field name, or @submit" } },
    examples: [{ act: "form.focus field=book", does: "starts filling the book field in this note" }],
    run({ field }, { surface, host }) { surface.focusForm(field, host); },
  }),
  "form.move": def({
    summary: "move between the form's fields", keys: modeActionKeys([FORM_KEYS], "form.move"), touches: "tile", replay: "safe", person: "the person's form focus",
    args: { by: { type: "number", about: "1 next, -1 previous" } },
    examples: [{ act: "form.move by=1", does: "moves to the next form field, keeping the answers" }],
    run({ by }, { surface, host }) { const f = surface.form; if (!f) throw new ActionRefused("this note has no form-field properties; write [form-field::name text] in its edit"); const at = (f.focus + by + f.fields.length + 1) % (f.fields.length + 1); surface.focusForm(f.fields[at]?.name ?? "@submit", host); },
  }),
  "form.leave": def({
    summary: "leave the form with its answers kept", keys: modeActionKeys([FORM_KEYS], "form.leave"), touches: "tile", replay: "safe", person: "the person's form focus", args: {},
    run(_, { surface, host }) { surface.leaveForm(); host.redraw(); },
  }),
  "form.place": def({
    summary: "place or extend the shared editor's cursor in a form field", keys: "click, drag", touches: "tile", replay: "safe", person: "the person's form cursor",
    args: { field: { type: "string", about: "field name" }, col: { type: "number", about: "zero-based column" }, extend: { type: "boolean", optional: true, about: "extend selection" } },
    examples: [{ act: "form.place field=book col=0", does: "places the cursor at the start of the book answer" }],
    run({ field, col, extend }, { surface, host }) { surface.focusForm(field, host); const d = surface.form!.draft(field); d.place(0, d.posAt(col, 0).col, extend); host.redraw(); },
  }),
  "form.input": def({
    summary: "type in the form with the shared editor", touches: "tile", replay: "ask", person: "the person's form editor",
    args: { key: { type: "string", about: "editor key as JSON" } },
    examples: [{ act: `form.input key='{"kind":"paste","text":"Piranesi"}'`, does: "pastes a book title into the focused field with the shared editor" }],
    run({ key }, { surface, host }) { const f = surface.form; if (!f) throw new ActionRefused("this note has no form-field properties; write [form-field::name text] in its edit"); f.input(JSON.parse(key) as Key, text => host.ctx.copy?.(text)); host.redraw(); },
  }),
  "form.set": def({
    summary: "answer one field of this note's form; agents keep their own answers", keys: modeActionKeys([FORM_CHOICE_KEYS], "form.set"), touches: "nothing", replay: "safe",
    args: { field: { type: "string", about: "field name" }, value: { type: "string", about: "answer" } },
    examples: [{ act: "form.set field=book value=Piranesi", does: "answers the book field for the actor submitting the form" }],
    run({ field, value }, { surface, host }, actor) { const f = surface.form; if (!f) throw new ActionRefused("this note has no form-field properties"); f.set(field, value, actor); if (actor.kind === "user") surface.focusForm(field, host); host.redraw(); return { answers: f.values(actor) }; },
  }),
  "form.submit": def({
    summary: "submit this note's form through ext.form.fill", keys: modeActionKeys([FORM_KEYS], "form.submit"), touches: "nothing", replay: "ask", args: {},
    async run(_, { surface, host }, actor) {
      const f = surface.form;
      if (!f) throw new ActionRefused("this note has no form-field properties");
      const warning = f.check(actor);
      if (warning) { f.warning(actor, warning); host.redraw(); return { warning }; }
      if (f.busy) throw new ActionRefused("the form is still submitting");
      f.busy = true;
      try {
        const sent = f.values(actor);
        const result = await host.ctx.dispatch!.act({ action: "ext.form.fill", args: { block: f.block, with: JSON.stringify(sent) } }, actor);
        // It landed: the form clears for the next entry, so a second press can't write the same one again (a refusal keeps it).
        f.reset(actor, sent);
        return result;
      } catch (error) { f.warning(actor, error instanceof Error ? error.message : String(error)); throw error; }
      finally { f.busy = false; host.redraw(); }
    },
  }),
  "ask.beside": def({
    summary: "show this ask's answer beside the note, keeping the person's keys in the note",
    touches: "shape", replay: "safe",
    args: { ask: { type: "string", about: "the ask line as written" }, fold: { type: "string", optional: true, about: "the selected answer's fold identity" } },
    examples: [
      { act: 'ask.beside ask="@margin which beds need mulch?"', does: "shows that ask's answer in a tile beside the note, keys staying in the note" },
    ],
    async run({ ask, fold }, { host }, actor) { return host.answerTile?.(ask, actor, fold) ?? null; },
  }),
  "rich.toggle": def({
    summary: "switch rich/raw edit; both views use the same draft",
    keys: "ctrl+o while editing, esc in rich edit", touches: "draft", draft: "type", replay: "safe",
    menu: noteRow("rich edit", "", {}),
    args: { on: { type: "boolean", optional: true, about: "rich view on or off" } },
    examples: [
      { act: "rich.toggle on=true", does: "turns rich edit on, opening the note's draft with its tables drawn as cells" },
      { act: "rich.toggle on=false", does: "turns rich edit off, back to the draft's raw text" },
    ],
    async run({ on }, { surface, host }, actor) {
      const { draft: d } = await surface.ensureDraft(host);
      const v = elementEdit(d);
      if (on ?? !v.on) v.open(actor); else v.on = false;
      d.follow = false;
      host.redraw(); return { rich: v.on };
    },
  }),
  "rich.move": def({
    summary: "move between cells; up/down leave a table at its edges",
    keys: "tab, shift+tab, up, down, enter in rich edit", touches: "draft", draft: "type", replay: "ask",
    args: { direction: { type: "string", about: "next, previous, up, down, left or right" } },
    examples: [
      { act: "rich.move direction=next", does: "moves the cursor to the next cell of the table" },
      { act: "rich.move direction=down", does: "moves the cursor one row down, leaving the table below its last row" },
    ],
    run({ direction }, { surface, host }) {
      if (!surface.draft) throw new ActionRefused("open rich.toggle first");
      if (!["next", "previous", "up", "down", "left", "right"].includes(direction)) throw new ActionRefused("direction must be next, previous, up, down, left or right");
      elementEdit(surface.draft).move(direction); host.redraw();
    },
  }),
  "rich.erase": def({
    summary: "erase a cell character; keep its delimiters",
    keys: "backspace, delete in rich edit", touches: "draft", draft: "type", replay: "ask",
    args: { backward: { type: "boolean", about: "delete before the cursor" } },
    examples: [
      { act: "rich.erase backward=true", does: "erases the character before the cursor in the cell, keeping the table's bars" },
      { act: "rich.erase backward=false", does: "erases the character after the cursor in the cell" },
    ],
    run({ backward }, { surface, host }, actor) {
      if (!surface.draft) throw new ActionRefused("open rich.toggle first");
      elementEdit(surface.draft).erase(backward, actor); host.redraw();
    },
  }),
  "rich.scroll": def({
    summary: "scroll the rendered draft without moving its cell cursor",
    keys: "wheel, pgup, pgdn in rich edit", touches: "draft", draft: "type", replay: "safe",
    args: { by: { type: "number", about: "rows to scroll" } },
    examples: [
      { act: "rich.scroll by=5", does: "scrolls the rendered draft down five rows, the cell cursor staying put" },
      { act: "rich.scroll by=-5", does: "scrolls the rendered draft up five rows" },
    ],
    run({ by }, { surface, host }) {
      if (!surface.draft) throw new ActionRefused("open rich.toggle first");
      elementEdit(surface.draft).scroll(by); host.redraw();
    },
  }),
  "rich.input": def({
    summary: "type or paste into a component field without changing its delimiters",
    keys: [{ via: "typing in rich edit" }, { keys: "paste", does: "in rich edit" }, { keys: "ctrl+k", does: "in rich edit" }], touches: "draft", draft: "type", replay: "ask",
    args: { text: { type: "string", about: "text to insert" }, cut: { type: "boolean", optional: true, about: "cut to the field's end" } },
    examples: [
      { act: 'rich.input text="3 trays"', does: "types 3 trays into the current table cell at the cursor" },
    ],
    run({ text, cut }, { surface, host }, actor) {
      if (!surface.draft) throw new ActionRefused("open rich.toggle first");
      elementEdit(surface.draft).input(text, actor, cut); host.redraw();
    },
  }),
  "rich.set": def({
    summary: "replace the current component field, in the draft's undo history; ctrl+s saves",
    touches: "draft", draft: "type", replay: "ask",
    args: { value: { type: "string", about: "the cell's value" } },
    examples: [
      { act: 'rich.set value="12 packets"', does: "replaces the current cell's text with 12 packets, as one undo step" },
    ],
    run({ value }, { surface, host }, actor) {
      if (!surface.draft) throw new ActionRefused("open rich.toggle first");
      elementEdit(surface.draft).set(value, actor); surface.noteAgent(actor, "edited a cell", surface.draft); host.redraw();
    },
  }),
  "rich.change": def({
    summary: "add, remove or move a row or column in the current table, as one draft undo step",
    keys: [{ keys: "alt+r", does: "add a row under this one, in rich edit" }, { keys: "alt+d", does: "remove this row, in rich edit" }, { keys: "alt+v", does: "add a column, in rich edit" }, { keys: "alt+x", does: "remove this column, in rich edit" }], touches: "draft", draft: "type", replay: "ask",
    args: { op: { type: "string", about: "row.add, row.remove, column.add, column.remove, row.move, column.move" }, to: { type: "number", optional: true, about: "destination row or column, from zero" } },
    examples: [
      { act: "rich.change op=row.add", does: "adds an empty row under the current row of the table" },
      { act: "rich.change op=column.move to=0", does: "moves the current column to the first place in the table" },
    ],
    run({ op, to }, { surface, host }, actor) {
      if (!surface.draft) throw new ActionRefused("open rich.toggle first");
      if (!["row.add", "row.remove", "column.add", "column.remove", "row.move", "column.move"].includes(op)) throw new ActionRefused("unknown table operation");
      elementEdit(surface.draft).change(op as ElementOperation, actor, to); surface.noteAgent(actor, op, surface.draft); host.redraw();
    },
  }),
  // The draft's own actions (Enter's list continuation, Tab, Shift+Tab, a click, the wheel, the preview),
  // on this reader's edit or the comment being written: the same code its keys and mouse run.
  "draft.newline": forwardDraft("draft.newline"),
  "draft.indent": forwardDraft("draft.indent"),
  "draft.outdent": forwardDraft("draft.outdent"),
  "draft.place": forwardDraft("draft.place"),
  "draft.scroll": { ...forwardDraft("draft.scroll"), keys: modeActionKeys(ATTACHED_KEYS, "draft.scroll") },
  "draft.preview": { ...forwardDraft("draft.preview"), keys: modeActionKeys(ATTACHED_KEYS, "draft.preview"), confirms: true, says: out => out.preview ? "opened the edit preview" : "closed the edit preview" },
  "draft.paste": forwardDraft("draft.paste"),
  "draft.undo": forwardDraft("draft.undo"),
  "draft.redo": forwardDraft("draft.redo"),
  "draft.copy": forwardDraft("draft.copy"),
  "complete.copy": def({
    ...COMPLETION_COPY,
    run(args, { surface }, actor) {
      const c = surface.writingDraft && completerOf(surface.writingDraft);
      if (!c?.shown) throw new ActionRefused("type :: in an edit first");
      return COMPLETION_ACTIONS.run("complete.copy", args, c, actor);
    },
  }),
  "complete.definition": def({
    ...COMPLETION_DEFINITION,
    run(args, { surface }, actor) {
      const c = surface.writingDraft && completerOf(surface.writingDraft);
      if (!c?.shown) throw new ActionRefused("type @ in an edit first");
      return COMPLETION_ACTIONS.run("complete.definition", args, c, actor);
    },
  }),
  "complete.preview": def({
    ...COMPLETION_PREVIEW,
    run(args, { surface }: On, actor) {
      const draft = surface.writingDraft;
      const c = draft && completerOf(draft);
      if (!c?.shown) throw new ActionRefused("no preview is open; type (( or :: in an edit or comment first");
      return COMPLETION_ACTIONS.run("complete.preview", args, c, actor);
    },
  }),
  // The open list's own keys (PIE-1339), on this reader's edit or the comment being written: the code the popup's keys,
  // wheel and clicks run. An agent's are its own draft's, or one it was invited into (draftRule's `type`).
  "complete.move": def({
    ...COMPLETION_MOVE,
    run(args, { surface }, actor) { return COMPLETION_ACTIONS.run("complete.move", args, openCompleter(surface), actor); },
  }),
  "complete.accept": def({
    ...COMPLETION_ACCEPT,
    args: { ...COMPLETION_ACCEPT.args, invitation: { type: "string", optional: true, about: "in the person's draft: the invitation their @name line gave this agent (used up only when it lands)" } },
    async run({ n, invitation }, on, actor): Promise<unknown> {
      const c = openCompleter(on.surface), s = c.shown!;
      // An agent's insert is `complete insert=`'s: the same checks, the same invitation spent, said on screen.
      if (actor.kind === "agent") return NOTE_ACTIONS.run("complete", { insert: n ?? s.index + 1, expect: s.items[(n ?? s.index + 1) - 1]?.insertion, invitation }, on, actor);
      return COMPLETION_ACTIONS.run("complete.accept", { n }, c, actor);
    },
  }),
  "complete.ask": def({
    ...COMPLETION_ASK,
    run(args, { surface, host }, actor) {
      const d = surface.writingDraft;
      // Made on first use, as a key typed there would (the edit's own completer, with its note as the search's context).
      const c = d && (completerOf(d) ?? surface.completer(d, host));
      if (!c) throw new ActionRefused("nothing is being written here; open an edit or a comment first");
      return COMPLETION_ACTIONS.run("complete.ask", args, c, actor);
    },
  }),
  "complete.dismiss": def({
    ...COMPLETION_DISMISS,
    run(args, { surface }, actor) { return COMPLETION_ACTIONS.run("complete.dismiss", args, openCompleter(surface), actor); },
  }),
  "complete.step": def({
    ...COMPLETION_STEP,
    run(args, { surface, host }, actor) {
      const d = surface.writingDraft;
      const c = d && completerOf(d);
      if (!c?.shown) throw new ActionRefused("type :: in an edit first");
      return COMPLETION_ACTIONS.run("complete.step", args, c, actor);
    },
  }),
  "complete": def({
    words: "complete what you're typing: a page, a reference, a file, a callout or a property",
    summary: "completion, as typing [[, ((, [file::, > [!, ::component, a property's [key:: or a figure's YAML offers it: the candidates for text (such as [[PIE-4, ((beds, ((garden#, [file::src/, [heading-pattern::, or a ::graph-meter block's lines ending in ti), or at the open draft's cursor; insert=n puts the nth into the draft (expect=<its insertion> refuses it if the list changed meanwhile); refine=^ or refine=# opens the finished ((reference)) at the draft's cursor again to search inside its note, as typing ^ or # in it does (PIE-762): a passage with no anchor gets one when inserted. Property keys and values come from the component schemas (PIE-618)",
    keys: [{ via: "typing [[ (( [file:: > [! ::component or [key:: while writing" }, { keys: "tab ctrl+space", does: "open the completion" }, { keys: "↑ ↓", does: "move in it" }, { keys: "enter tab", does: "choose", says: "insert the lit completion" }, { keys: "esc", does: "close it", says: "close the completion list" }, { keys: "^ #", does: "in a ((reference))" }],
    // Looking candidates up reads; putting one in types in the draft at its cursor: an agent's only in a draft it
    // opened and alone typed in, or one the person invited it into (an @name line; the insert uses the invitation up).
    touches: "draft", draft: "type", replay: "ask",
    touchesWith: ({ insert, refine }) => (insert === undefined && refine === undefined ? "nothing" : "draft"),
    args: {
      text: { type: "string", optional: true, about: "text ending in the token to complete; leave out to complete at the draft's cursor" },
      key: { type: "string", optional: true, about: "with text=: complete text as the value of this property (the property panel's field: the outline's values for it, then the schemas'); a [[ or (( in it still offers pages and blocks" },
      insert: { type: "number", optional: true, about: "put the nth candidate (from 1) into the draft at its cursor, as enter does" },
      step: { type: "number", optional: true, about: "list variations and arguments of this component row (from 1)" },
      refine: { type: "string", optional: true, about: "^ or #: open the finished ((reference)) at the draft's cursor again, to search inside its note (^ every passage, its anchors first; # its headings); then insert=n" },
      expect: { type: "string", optional: true, about: "with insert=: the nth candidate's insertion as listed; refused when the list has changed since (a pause can have Jev re-order it)" },
      invitation: { type: "string", optional: true, about: "insert= in the person's draft: the invitation their @name line gave this agent (one step, used up only when it lands); not for a draft of the agent's own" },
    },
    examples: [
      { act: 'complete text="[[seed-sw"', does: "lists the pages whose names match seed-sw, as typing [[seed-sw would" },
      { act: "complete insert=2", does: "puts the second candidate into the draft at the cursor" },
    ],
    async run({ text, key, insert, invitation, expect, refine, step }, { surface, host }, actor) {
      const board = host.ctx.board as unknown as CompletionBoard;
      if (typeof board?.completePages !== "function") throw new ActionRefused("this connection can't look references up");
      const d = surface.writingDraft;
      if ((insert !== undefined || refine !== undefined) && text !== undefined) throw new ActionRefused(`${insert !== undefined ? "insert" : "refine"} completes at the draft's cursor; leave text out`);
      if (refine !== undefined) {
        if (refine !== "^" && refine !== "#") throw new ActionRefused(`refine is ^ (every passage) or # (headings), not ${JSON.stringify(refine)}`);
        if (!d) throw new ActionRefused("nothing is being written here; open an edit or a comment first");
        if (d.busy) throw new ActionRefused("the save is still landing");
        if (!reopenReference(d, refine, actor)) throw new ActionRefused(`the draft's cursor (line ${d.row + 1}, column ${d.col + 1}) isn't in a finished ((reference)) without a label; put it inside one, or just after its ))`);
        surface.noteAgent(actor, `opened a ((reference)) to refine it with ${refine}`, d);
      }
      let target: CompletionTarget | null;
      if (text !== undefined) {
        const lines = text.split("\n"), line = lines.at(-1)!;
        target = completionTargetAtCursor(line, line.length, lines, lines.length - 1);
        if (!target && key) target = { kind: "filter-value", start: 0, end: line.length, query: line, key };
        if (!target) throw new ActionRefused(`nothing to complete: text should end inside [[, ((, [file::, > [!, ::component, a [key:: property or a figure's YAML (it ends ${JSON.stringify(line.slice(-20))})`);
      } else {
        if (!d) throw new ActionRefused("nothing is being written here; pass text=\"[[...\" or open an edit first");
        target = completionTargetAtCursor(d.lines[d.row] ?? "", d.col, d.lines, d.row);
        if (!target) throw new ActionRefused(`the draft's cursor (line ${d.row + 1}, column ${d.col + 1}) isn't inside [[, ((, [file::, > [!, ::component, a [key:: property or a figure's YAML`);
      }
      // The draft as the target was read from it: typing during the lookups below moves the token, and a
      // splice at the old span would land in the wrong place, so any change refuses the insert.
      const at = d && { text: d.text, row: d.row, col: d.col };
      const still = () => !!d && !!at && d.text === at.text && d.row === at.row && d.col === at.col;
      const own = surface.draft ? { blockId: surface.draft.blockId, text: surface.draft.text } : undefined;
      // What the person's popup shows, when it is open on this token (Jev's order included), so insert=n is
      // the nth they see; else the same lookup it makes, from the same note (with no draft, the note read here).
      const shown = d ? completionOf(d) : null;
      const r = text === undefined && shown && !shown.loading && shown.target.kind === target.kind && shown.target.start === target.start && shown.target.query === target.query
        ? shown : await lookupCompletion(board, target, own, { near: nearOf(d, own) ?? surface.msg?.id });
      if (step !== undefined) {
        const item = r.items[step - 1];
        if (!item?.children) throw new ActionRefused("step names a component row; complete text=:: lists them");
        // Its variations, then its arguments (each a `property` row), as the service answered them (PIE-1344).
        const variations = item.children.filter(it => it.kind !== "property"), args = item.children.filter(it => it.kind === "property");
        return { variations: variations.map((it, i) => ({ n: i + 1, label: it.label, insertion: it.insertion })), props: args.map(it => ({ key: it.label, type: it.detail, meaning: it.docs })) };
      }
      const out = {
        kind: target.kind, query: target.query, message: r.message || undefined, truncated: r.truncated ?? undefined,
        items: r.items.map((it, i) => ({ n: i + 1, label: it.label, insertion: it.insertion, kind: it.kind, blockId: it.blockId, address: it.address, fragmentId: it.fragmentId, detail: it.detail, docs: it.docs || undefined })),
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
      surface.noteAgent(actor, `inserted ${item.insertion}`);
      host.redraw();
      return { ...out, inserted: item.insertion, dirty: d.dirty };
    },
  }),
  "edit": def({
    summary: "open the note for editing (its whole text, at the revision the service has now); external=true opens it in $EDITOR (a reader's ctrl+e; in an open edit, or a comment or reply being written, edit.external, ctrl+x ctrl+e, hands that over). The person's e arms it first (edit.arm) and ⏎ or e again opens it; a click on an edit control opens it at once", keys: "e then ⏎/e, ctrl+e then ⏎/ctrl+e (e or ctrl+e alone when arming is off)",
    touches: "draft", draft: "write", replay: "ask",
    menu: noteRow("edit", "e", { now: ({ surface }) => (surface.draft ? { hide: true } : null) }),
    personWith: a => (a.external ? "the $EDITOR handoff takes over the person's terminal; send the text with edit.text" : null),
    args: { external: { type: "boolean", optional: true, about: "hand the draft to $EDITOR (the person's keys only)" } },
    examples: [
      { act: "edit", does: "opens the note's whole text for editing, at the revision the service has now" },
      { act: "edit external=true", does: "opens the note in $EDITOR in a terminal tile beside the reader" },
    ],
    async run({ external }, { surface, host }, actor) {
      // Already writing here: that draft, or the comment or reply, goes to $EDITOR (edit.external's).
      if (external && (surface.draft || writingIn(surface))) return handToEditor(surface, host);
      if (surface.draft) return { already: true, id: surface.draft.blockId, baseRevision: surface.draft.base };
      const { draft: d } = await surface.ensureDraft(host);
      if (external) void openInEditor(host.ctx, d, () => surface.draft === d).then(() => host.redraw());
      surface.noteAgent(actor, "opened this note for editing");
      return { id: d.blockId, baseRevision: d.base };
    },
  }),
  "revision.restore": def({
    summary: "go back to an earlier revision of the note (PIE-621): the edit opens (or the open one is used) and that revision's text goes in as one undo step, said with when it was saved; nothing is written until it's saved (ctrl+s), and ctrl+z takes it back. Without revision=, the one before what the edit holds (run it again to go further back). The service keeps the newest 100 texts a note had (`ep0ch revisions <note>` lists them). An agent's: only in an edit it opened",
    keys: [{ via: "the tile menu's \"an earlier revision\"" }],
    touches: "draft", draft: "replace", replay: "ask",
    menu: noteRow("an earlier revision", "", { now: ({ surface }) => (surface.session ? { hide: true } : null) }),
    args: { revision: { type: "number", optional: true, about: "the revision (`ep0ch revisions <note>` lists them); default the one before what the edit holds" } },
    examples: [
      { act: "revision.restore", does: "puts the revision before the edit's text into the edit, unsaved, as one undo step" },
      { act: "revision.restore revision=3", does: "puts revision 3's text into the edit, unsaved, as one undo step" },
    ],
    async run({ revision }, { surface, host }, actor) {
      surface.requireNote();
      const { draft: d } = await surface.ensureDraft(host);
      const list = await host.ctx.board.revisions(d.blockId);
      const from = d.revisionShown ?? d.base;
      const want = revision ?? list.revisions.find(r => r.revision < from)?.revision;
      if (want === undefined) throw new ActionRefused(`no revision before ${from} is kept for this note (the service keeps them from the first save after PIE-621)`);
      const r = await host.ctx.board.revisionText(d.blockId, want);
      d.replace(r.text, actor, `revision ${want}'s text`, true);
      d.revisionShown = want;
      d.note = `revision ${want} of ${list.revision}, saved ${whenPut(Date.parse(r.savedAt))}${revisionByline(r) ? ` ${revisionByline(r)}` : ""} · ctrl+s saves it as the note · ctrl+z takes it back`;
      surface.noteAgent(actor, `put revision ${want}'s text into the edit`);
      host.redraw();
      return { revision: want, current: list.revision, savedAt: r.savedAt, chars: r.chars, earlier: list.revisions.filter(x => x.revision < want).map(x => x.revision) };
    },
  }),
  "revision.compare": def({
    summary: "this note at an earlier revision, beside how it is now (PIE-1433): revision's text marked against the next revision kept (- was there, + came next), or against=now the note as it is now; ← → older and newer, Esc back to the note. Without revision=, the one before the note now. A suggestions page row (a table with at:) and the history list open it",
    keys: [{ via: "a table row with at: (the suggestions page)" }, { via: "the tile menu's \"history\"" }],
    touches: "tile", replay: "safe",
    args: { revision: { type: "number", optional: true, about: "the revision (revisions or `ep0ch revisions <note>` lists them); default the one before the note now" },
      against: { type: "string", optional: true, about: "next (the default: the next revision kept) or now (the note as it is now)" },
      passage: { type: "string", optional: true, about: "text to scroll to (a review's passage); default the first change" } },
    examples: [
      { act: "revision.compare", does: "shows the last change: the revision before the note now, marked against it" },
      { act: "revision.compare revision=3", does: "shows revision 3 beside the note, marked against revision 4" },
      { act: "revision.compare revision=3 against=now", does: "shows revision 3 marked against the note as it is now" },
    ],
    async run({ revision, against, passage }, { surface, host, standing }) {
      if (against !== undefined && against !== "next" && against !== "now") throw new ActionRefused("against is next or now");
      const m = surface.requireNote(), to = (against ?? "next") as RevisionAgainst;
      if (!standing) return { ...revisionFacts({ diff: await compareAt(host.ctx.board, m.id, revision, to), against: to, top: 0 }), shown: false };
      return { ...revisionFacts(await surface.openRevision(host, revision, to, passage)), shown: true };
    },
  }),
  "revision.older": def({
    summary: "in the revision compare, the revision before the one shown (still against the next, or now)", keys: modeActionKeys(ATTACHED_KEYS, "revision.older"),
    touches: "tile", replay: "safe", args: {},
    async run(_, { surface, host }) {
      const mode = surface.revisionMode, v = mode?.view;
      if (!mode || !v) throw new ActionRefused("open the revision compare first (revision.compare)");
      // From the revision asked last, not the one drawn: a second ← before the first's answer steps again.
      const from = mode.want ?? v.diff.from.revision;
      const older = v.diff.list.revisions.find(r => r.revision < from);
      if (!older) throw new ActionRefused(`revision ${from} is the oldest kept for this note`);
      mode.want = older.revision;
      return revisionFacts(await surface.openRevision(host, older.revision, v.against));
    },
  }),
  "revision.newer": def({
    summary: "in the revision compare, the revision after the one shown", keys: modeActionKeys(ATTACHED_KEYS, "revision.newer"),
    touches: "tile", replay: "safe", args: {},
    async run(_, { surface, host }) {
      const mode = surface.revisionMode, v = mode?.view;
      if (!mode || !v) throw new ActionRefused("open the revision compare first (revision.compare)");
      const from = mode.want ?? v.diff.from.revision;
      const newer = [...v.diff.list.revisions].reverse().find(r => r.revision > from && r.revision < v.diff.current);
      if (!newer) throw new ActionRefused(`revision ${from} is the last before the note now`);
      mode.want = newer.revision;
      return revisionFacts(await surface.openRevision(host, newer.revision, v.against));
    },
  }),
  "revision.against": def({
    summary: "in the revision compare, mark the revision against the note as it is now, or (again) against the next revision", keys: modeActionKeys(ATTACHED_KEYS, "revision.against"),
    touches: "tile", replay: "safe", args: { to: { type: "string", optional: true, about: "now or next; left out, the other one" } },
    examples: [{ act: "revision.against to=now", does: "marks the revision shown against the note as it is now" }, { act: "revision.against to=next", does: "marks it against the revision after it again" }],
    async run({ to }, { surface, host }) {
      const v = surface.revisionMode?.view;
      if (!v) throw new ActionRefused("open the revision compare first (revision.compare)");
      if (to !== undefined && to !== "now" && to !== "next") throw new ActionRefused("to is now or next");
      return revisionFacts(await surface.openRevision(host, surface.revisionMode!.want ?? v.diff.from.revision, (to ?? (v.against === "now" ? "next" : "now")) as RevisionAgainst, v.passage));
    },
  }),
  "revision.scroll": def({
    summary: "scroll the revision compare's rows", keys: modeActionKeys(ATTACHED_KEYS, "revision.scroll"),
    touches: "tile", replay: "safe", args: { by: { type: "number", about: "rows, down when positive" } },
    examples: [{ act: "revision.scroll by=8", does: "scrolls the compare down a page" }, { act: "revision.scroll by=-1", does: "scrolls it up a row" }],
    run({ by }, { surface, host }) {
      const mode = surface.revisionMode;
      if (!mode) throw new ActionRefused("open the revision compare first (revision.compare)");
      mode.view.top = Math.max(0, mode.view.top + by);
      host.redraw();
      return { top: mode.view.top };
    },
  }),
  "revision.focus": def({
    summary: "give the keys to the revision compare or back to the comment being written beside it, keeping both open", keys: "a click in the compare, or on the note",
    touches: "shape", replay: "safe", person: "the compare's keys are the person's; an agent reads revision.compare",
    args: { on: { type: "boolean", about: "true gives the keys to the compare; false returns them to the reader and its comment" } },
    examples: [{ act: "revision.focus on=false", does: "returns the keys to the comment being written" }],
    run: ({ on }, { surface, host }) => surface.focusRevision(host, on),
  }),
  "revision.close": def({
    summary: "close the revision compare: back to the note as it is now", keys: modeActionKeys(ATTACHED_KEYS, "revision.close"), confirms: true, says: () => "closed the revision compare",
    touches: "tile", replay: "safe", args: {},
    run(_, { surface, host }) { const open = !!surface.revisionMode; surface.closeRevision(); host.redraw(); return { closed: open }; },
  }),
  "revisions": def({
    summary: "the note's history (PIE-621, PIE-1433): the current revision, then the earlier texts the service keeps, newest first, each with when it was saved, by whom, its size and first line. The person's lists them over the screen (the tile menu's history); choosing one opens it beside how the note is now (revision.compare). An agent gets the list; revision.restore puts one into the edit",
    keys: [{ via: "the tile menu's \"history\"" }],
    touches: "nothing", replay: "safe",
    menu: noteRow("history", ""),
    args: {},
    async run(_, { surface, host, standing }) {
      const m = surface.requireNote(), list = await host.ctx.board.revisions(m.id);
      if (!standing) return list;
      const rows = list.revisions.filter(r => r.revision < list.revision);
      if (!rows.length) throw new ActionRefused(`no earlier text is kept for this note (it is at revision ${list.revision})`);
      if (!host.overlay) throw new ActionRefused(`this screen can't list the history over it · revision.compare revision=${rows[0]!.revision} opens the last change`);
      const line = (r: (typeof rows)[number]) => `${String(r.revision).padStart(4)}  ${whenPut(Date.parse(r.savedAt)).padEnd(12)} ${revisionByline(r) || "·"}  ${printable(r.firstLine)}`;
      const picker = new ListPicker<(typeof rows)[number], unknown>({
        name: "history", items: () => rows, clickChooses: true,
        row: (r, _i, on, w) => [pickRow(line(r), on, w)],
        choose: r => { void surface.runKey("revision.compare", { revision: r.revision }, host); },
        frame: (a, n) => ({ rect: centred(a, Math.min(80, a.cols - 2), Math.min(n + 2, a.rows)), title: `history · ${subject(m)} · now revision ${list.revision}` }),
      });
      host.overlay(picker);
      return { ...list, shown: true };
    },
  }),
  "edit.arm": def({
    hintId: "confirm",
    hint: (_, { surface, host }) => host.ctx.armed?.()?.of === surface ? CONFIRM_HINT : null,
    summary: "the person's e (ctrl+e: for $EDITOR) in a reader: arm the edit instead of opening it. The status bar asks `edit <title>? ⏎ · any other key cancels` and the reader's frame turns the edit's colour; ⏎ or the same key again within the window (edit.arm.set, or EP0CH_EDIT_ARM over it; default 2000 ms) opens it (edit), any other key lets it go and does what it does, and the window running out lets it go. edit.arm.set on=false (or EP0CH_EDIT_ARM=off) opens it at once. A click on an edit control, and an agent's edit, open at once",
    keys: "e, ctrl+e", touches: "nothing", replay: "ask",
    person: "arming is the person's e key, so a stray key never opens an edit; an agent opens one with edit (edit.text puts text in it)",
    args: { external: { type: "boolean", optional: true, about: "arm ctrl+e's $EDITOR handoff instead" } },
    examples: [
      { act: "edit.arm", does: "asks in the status bar whether to edit the note; enter or e again opens it" },
      { act: "edit.arm external=true", does: "asks whether to edit the note in $EDITOR; ctrl+e again opens it" },
    ],
    run({ external }, { surface, host }) {
      const m = surface.requireNote();
      const kind: SessionKind = external ? "external" : "edit";
      // Opened as the key did before arming: through the host where it keeps track of the person's session.
      const open = (opener?: Key) => {
        // The reader moved on while it was armed (a lane's preview followed another card, the note was opened over):
        // the question named this note, so nothing opens on another.
        if (surface.msg?.id !== m.id) { host.ctx.flash("not opened: the reader shows another note now · e edits it"); host.redraw(); return; }
        if (host.startSession) return void host.startSession(kind, opener);
        void surface.startAsPerson(kind, host).catch(e => { host.ctx.flash(e instanceof Error ? e.message : String(e), undefined, errorDetails(e)); host.redraw(); });
      };
      const ms = editArmMs();
      // Already editing here (ctrl+e hands that draft over), arming off, or a door that can't hold an arm: at once.
      if (surface.draft || surface.session || !ms || !host.ctx.arm) { open(); return { opened: m.id }; }
      const title = subject(m);
      const say = hintSetting("confirm", host.look?.values.hints ?? surface.lastLook?.values.hints ?? "full") === "status" ? hintStatus(CONFIRM_HINT) : "confirm";
      host.ctx.arm({ of: surface, what: title, say, key: external ? { kind: "char", ch: "e", ctrl: true } : { kind: "char", ch: "e" }, ms, run: open });
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
    keys: [{ keys: "ctrl+t", does: "pick" }, { keys: "click", does: "[insert] in the edit's, comment's or reply's title row" }],
    touches: "draft", draft: "type", replay: "ask",
    person: "an agent doesn't hand the person's terminal to a picker; put text in their draft with draft.patch, or in an edit it opened with edit.text",
    args: { channel: { type: "string", optional: true, about: "the picker's argument (a television channel: ep0ch, ep0ch-files …); empty for none" } },
    examples: [
      { act: "draft.pick", does: "opens the picker on the default channel; its choice goes in at the cursor" },
      { act: "draft.pick channel=ep0ch-files", does: "opens the picker on the ep0ch-files channel; its choice goes in at the cursor" },
    ],
    async run({ channel }, { surface, host }) {
      return await surface.pick(host, channel);
    },
  }),
  "draft.image": def({
    summary: "put a picture in this reader's edit or comment at the cursor (PIE-592): the image file whose path the cursor is on (a file dropped on the terminal pastes its path, as text), else the one on the clipboard, or path=; it's copied into the outline's folder (media/, named by its day and contents) and a media line [img::<path>] goes in on its own line, one undo step. The clipboard is read on the door's machine",
    keys: "ctrl+v in an edit or a comment (on a dropped file's path: that file), a paste of nothing but a picture",
    touches: "draft", draft: "type", replay: "ask",
    args: { path: { type: "string", optional: true, about: "an image file on the door's machine to put in, instead of the clipboard's" } },
    examples: [
      { act: "draft.image", does: "puts the clipboard's picture in at the cursor as an [img::] line" },
      { act: "draft.image path=/tmp/shed-roof.png", does: "copies that picture into the outline and adds its [img::] line at the cursor" },
    ],
    async run({ path }, { surface, host }, actor) {
      const d = surface.writingDraft;
      if (!d) throw new ActionRefused("nothing is being written here; open an edit (e) or a comment first");
      if (d.busy) throw new ActionRefused("the save is still landing");
      // Pictures live in the outline's folder: on this machine only (a remote outline's is on its host).
      const info = await host.ctx.board.info().catch(() => null);
      if (!info || info.host !== hostname()) throw new ActionRefused(`the outline is on ${info?.host ?? "another machine"}: a picture goes into an outline on this machine, or put [img::<path>] in by hand`);
      const dropped = path === undefined ? imagePathAt(d.lines[d.row] ?? "", d.col) : null;
      let from: Buffer | string | null = path !== undefined ? droppedImage(path) : dropped?.path ?? null;
      if (path !== undefined && !from) throw new ActionRefused(`${path} isn't an image file on this machine (png, jpg, gif, webp…)`);
      if (!from) from = await clipboardImage();
      // The draft may have been saved, closed or replaced while the clipboard was read.
      if (surface.writingDraft !== d || d.busy) throw new ActionRefused("the draft changed while the clipboard was read; nothing was put in");
      if (!from) { d.note = noClipboardImage(); host.redraw(); throw new ActionRefused(d.note); }
      let kept: string;
      try { kept = keepImage(info.workspace, from); }
      catch (e) { d.note = (e as Error).message; host.redraw(); throw new ActionRefused(d.note); }
      d.putLine(imageLine(kept), actor, dropped ?? undefined);
      d.note = `put in ${kept.split("/").slice(-2).join("/")} · ctrl+z takes it out (the file stays)`;
      host.redraw();
      return { path: kept, line: d.row + 1 };
    },
  }),
  "edit.follow": def({
    summary: "open the link the cursor is on in this reader's edit or comment (or ref=: a link its preview draws, ((id)), [[page]], a URL or #tag) beside it, as a reader's link opens: the edit stays open as it is and the keys stay in it (PIE-592). Opened again from the same edit, it reuses that detail",
    keys: [{ keys: "ctrl+l", does: "in an edit or a comment" }, { keys: "alt-click ctrl-click", does: "on a link in its text" }, { keys: "click", does: "on a link in its preview (ctrl+p)" }],
    touches: "tile", replay: "ask", way: "an agent opens a note beside the person's edit with open id= naming no tile",
    args: { ref: { type: "string", optional: true, about: "the link to open: ((id)) or ((id^fragment)), [[page]], a URL or #tag; default the one at the cursor" } },
    examples: [
      { act: "edit.follow", does: "opens the link under the cursor beside the edit, which stays open" },
      { act: 'edit.follow ref="[[garden]]"', does: "opens the garden page beside the edit, which stays open" },
    ],
    async run({ ref }, { surface, host }) {
      const d = surface.writingDraft;
      if (!d) throw new ActionRefused("nothing is being written here; link.follow opens a link in what a reader shows");
      const at = ref === undefined ? d.linkAtCursor() : null;
      const l = ref !== undefined ? linkOfRef(ref) : at && linkOf(at);
      if (!l) throw new ActionRefused(ref !== undefined ? `${ref} isn't a link: give ((id)), [[page]], a URL or #tag` : "no link at the cursor: put it on a [[page]], ((reference)) or [text](url)");
      const m = await surface.followFromDraft(l, host);
      return m && "id" in m ? { opened: m.id, title: subject(m) } : m && "outside" in m ? { opened: null, ...m } : { opened: null };
    },
  }),
  "note.thread": def({
    summary: "open the message's replies in place, including moved replyTo notes; conference children count as replies",
    keys: "t", touches: "nothing", replay: "safe", menu: { label: "read this thread", group: "note", key: "t" }, args: {},
    run: (_, { surface, host }, actor) => surface.openReplyLinks(host, actor),
  }),
  "note.thread.close": def({
    summary: "close the replies drawer", keys: modeActionKeys(ATTACHED_KEYS, "note.thread.close"), confirms: true, says: () => "closed the replies", touches: "tile", replay: "safe", person: "the person's drawer", args: {},
    run(_, { surface, host }) { surface.closeReplyLinks(); host.redraw(); return { closed: true }; },
  }),
  "note.thread.pick": def({
    summary: "move through the thread, or select one row (n)", keys: modeActionKeys(ATTACHED_KEYS, "note.thread.pick"), touches: "tile", replay: "safe", person: "the person's selection", args: { by: { type: "number", optional: true, about: "rows to move" }, n: { type: "number", optional: true, about: "row number to select (starts at one): a click" } },
    examples: [
      { act: "note.thread.pick by=1", does: "moves the thread's selection down one row" },
      { act: "note.thread.pick n=3", does: "selects the third row of the thread" },
    ],
    async run({ by, n }, { surface, host }, actor) {
      const m = surface.replyLinks;
      // The panel keeps the person's selected row while its note is read for a preview.
      if (m) { m.selected = Math.max(0, Math.min(m.rowsAt.length - 1, n !== undefined ? n - 1 : m.selected + (by ?? 0))); m.picked = actor.kind === "user"; }
      const row = m?.rowsAt[m.selected], target = row && linkTargetOf(row);
      if (target?.block && host.preview) {
        const note = await host.ctx.board.get(target.block);
        if (note && surface.replyLinks === m && m?.rowsAt[m.selected]?.key === row?.key) host.preview(note);
      }
      host.redraw(); return { selected: m?.selected };
    },
  }),
  "note.thread.groups": def({
    summary: "cycle the thread, the replies, outlinks and backlinks", keys: modeActionKeys(ATTACHED_KEYS, "note.thread.groups"), touches: "tile", replay: "safe", person: "the person's drawer", args: {},
    run(_, { surface, host }) { const m = surface.replyLinks; if (m) { m.top = 0; m.group = m.group === "thread" ? "children" : m.group === "children" ? "outlinks" : m.group === "outlinks" ? "backlinks" : "thread"; m.selected = m.group === "thread" ? Math.max(0, threadRows(m.thread, m.unfolded).findIndex(r => r.kind === "child" && r.thread?.here)) : 1; m.picked = false; } host.redraw(); return { group: m?.group }; },
  }),
  "note.thread.open": def({
    summary: "read the selected post through the tile's open wire, or its alt wire with fresh=true (a fold row opens its posts)", keys: modeActionKeys(ATTACHED_KEYS, "note.thread.open"), touches: "tile", replay: "safe", person: "the person's drawer", args: { n: { type: "number", optional: true, about: "row number (starts at one)" }, fresh: { type: "boolean", optional: true, about: "use the alt wire, as alt+Enter does" } },
    examples: [
      { act: "note.thread.open", does: "opens the selected post of the thread in the reader" },
      { act: "note.thread.open n=2", does: "opens the second row's post of the thread in the reader" },
    ],
    async run({ n, fresh }, { surface, host }) { const m = surface.replyLinks, row = m?.rowsAt[n === undefined ? m.selected : n - 1];
      if (row?.kind === "fold") throw new ActionRefused("that row is a fold, not a post: note.thread.unfold shows what it hides");
      const target = row && linkTargetOf(row); if (!target) return { opened: null }; surface.closeReplyLinks(); const note = await surface.open(target, host, fresh); return { opened: note && "id" in note ? note.id : null }; },
  }),
  "note.thread.unfold": def({
    summary: "show the posts a fold row of the thread hides", keys: modeActionKeys(ATTACHED_KEYS, "note.thread.unfold"), touches: "tile", replay: "safe", person: "the person's drawer", args: { n: { type: "number", optional: true, about: "row number (starts at one)" } },
    examples: [
      { act: "note.thread.unfold n=4", does: "shows the posts the fourth row of the thread, a fold, hides" },
    ],
    run({ n }, { surface, host }) {
      const m = surface.replyLinks, row = m?.rowsAt[n === undefined ? m.selected : n - 1];
      if (!m || row?.kind !== "fold") throw new ActionRefused("that row isn't a fold");
      m.unfolded.add(row.key.slice(`fold${SEP}`.length)); m.selected = m.rowsAt.indexOf(row); m.picked = false; m.presses.forget(); host.redraw();
      return { unfolded: row.count };
    },
  }),
  "note.thread.full": def({
    summary: "open the full THREAD message list", keys: modeActionKeys(ATTACHED_KEYS, "note.thread.full"), touches: "screen", replay: "safe", person: "the person's screen", args: {},
    async run(_, { surface, host }) {
      const m = surface.requireNote(), { MessageList } = await import("../screens");
      surface.closeReplyLinks();
      host.ctx.push(new MessageList(`thread: ${subject(m)}`, async () => (await readReplies(host.ctx.board, m.id, host.conference)).children.map(c => c.block), "", false));
      return { opened: "thread" };
    },
  }),
  "note.quote": def({
    summary: "insert a frozen selection with its source block (and existing anchor) into the reply, opening one if needed",
    keys: '\"', touches: "draft", draft: "type", replay: "ask",
    menu: { label: "quote into a reply", group: "note", key: '\"' },
    args: { quote: { type: "string", optional: true, about: "exact source words; otherwise your selection" } },
    examples: [
      { act: "note.quote", does: "puts the selected words into a reply to this note as a quote" },
      { act: 'note.quote quote="mulch the beds in March"', does: "puts those exact words into a reply to this note as a quote" },
    ],
    async run({ quote }, { surface, host }, actor): Promise<unknown> {
      const parent = surface.requireNote();
      const text = await surface.quoteSelection(host, actor, quote);
      if (movedOn(host, surface, parent.id)) throw new ActionRefused("the reader moved while the quote was read");
      if (actor.kind === "agent") return surface.act("note.reply", { text }, host, actor);
      const s = surface.replyParent ? surface.drafting! : surface.startReply(host);
      s.draft.pasteText(text, actor);
      surface.clearSelections();
      host.redraw();
      return { quoted: surface.requireNote().id };
    },
  }),
  "note.reply": def({
    summary: "write a reply beside this message; Save creates a child with replyTo and the message's thread, Esc closes without posting",
    keys: "R", touches: "nothing", replay: "ask",
    menu: { label: "reply to this note", group: "note", key: "R" },
    args: { text: { type: "string", optional: true, about: "reply text; an agent supplies this and creates the note without opening an editor" } },
    examples: [
      { act: "note.reply", does: "opens a reply beside this note for the person to write" },
      { act: 'note.reply text="Peas went in on Saturday"', does: "posts that as a reply to this note (the person's opens the reply with it)" },
    ],
    async run({ text }, { surface, host }, actor) {
      const parent = surface.requireNote();
      if (actor.kind === "agent") {
        if (text === undefined) throw new ActionRefused("supply text= for an agent's reply");
        const s = DraftSession.open(noteReplyTarget(parent, host.ctx.board), { text, by: actor });
        const result = await s.submit(actor);
        s.dispose();
        if (!result.ok) throw new ActionRefused(result.why);
        surface.noteAgent(actor, "replied to this note");
        return result.result;
      }
      const quote = surface.selection ? await surface.quoteSelection(host, actor) : undefined;
      if (movedOn(host, surface, parent.id)) return { replying: null };
      const s = surface.startReply(host, quote);
      if (text !== undefined) s.replace(text, actor);
      return { replying: parent.id };
    },
  }),
  "edit.button": def({
    summary: "insert an act line as a note button at the person's cursor, in one unsaved draft step",
    touches: "draft", draft: "type", replay: "ask", person: "inserting at the person's cursor belongs to them",
    args: { line: { type: "string", about: "the act line the button runs" } },
    examples: [{ act: 'edit.button line="tile.collapse on=true"', does: "inserts a collapse button at the note cursor, leaving the draft unsaved" }],
    async run({ line }, { surface, host }, actor) {
      const button = commandButton(line);
      const session = await surface.ensureDraft(host);
      if (session.openedBy.kind !== "user") throw new ActionRefused("this draft belongs to an agent; open your own edit first");
      const d = session.draft;
      // Source line zero is the title; a button belongs below it.
      if (d.row === 0) d.place(0, d.lines[0]!.length);
      const before = d.text.slice(0, d.offsetOf(d.row, d.col)), after = d.text.slice(d.offsetOf(d.row, d.col));
      await session.act("draft.paste", { text: (before && !before.endsWith("\n") ? "\n" : "") + button + (after && !after.startsWith("\n") ? "\n" : "") }, actor);
      host.redraw();
      return { inserted: button, dirty: session.dirty };
    },
  }),
  "edit.text": def({
    summary: "replace the draft's whole text (opens the edit first if needed); like text coming back from $EDITOR. An agent's replaces only an edit it opened, never while the person types in that reader (draft.patch lands in theirs)",
    touches: "draft", draft: "replace", replay: "ask",
    args: { text: { type: "string", about: "subject line, body and [key::value] properties" } },
    examples: [
      { act: 'edit.text text="Seed swap list, bring envelopes"', does: "replaces the draft's whole text with that line, opening the edit first" },
    ],
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
  "edit.actions": def({
    words: "run an action from where you're typing",
    summary: "list the actions that apply here at the cursor, in the edit's own completion float (PIE-1076): a `/` line under the cursor's (or the cursor's own line, when empty), then the action's arguments in place as you choose it; ⏎ runs it (edit.run). ctrl+k is the power bar's key everywhere else, and its actions here",
    keys: [{ keys: "ctrl+k", does: "in a note's edit" }, { keys: "/", does: "first on a line of a note's edit" }], touches: "draft", draft: "type", replay: "safe",
    args: {},
    examples: [{ act: "edit.actions", does: "puts a / line under the cursor's line and lists the actions that apply here" }],
    async run(_, { surface, host }, actor) {
      const d = surface.draft;
      if (!d) throw new ActionRefused("nothing is being edited here · e edits the note, then ctrl+k or / lists its actions");
      if (d.busy) throw new ActionRefused("the save is still landing");
      if (!actionHereAt((d.lines[d.row] ?? ""), d.col, d.lines, d.row)) {
        if ((d.lines[d.row] ?? "").trim()) { d.place(d.row, (d.lines[d.row] ?? "").length); d.pasteText("\n", actor); }
        d.pasteText("/", actor);
      }
      const c = surface.completer(d, host);
      await c?.refresh(true);
      host.redraw();
      return { rows: c?.shown?.items.length ?? 0, line: d.row + 1 };
    },
  }),
  "edit.run": def({
    words: "run the action typed on its / line",
    summary: "run the action on the cursor's `/` line (or line=, an act line without the /) on this note: the line is taken out, the edit saved (it leaves, as ctrl+s does) and the action run here as the power bar would run it; its result is one undo step (ctrl+z in the reader)",
    keys: [{ keys: "enter", does: "on a / line of a note's edit, with no list open" }], touches: "draft", draft: "leave", replay: "ask",
    args: { line: { type: "string", optional: true, about: "the act line to run (ext.structure.sort-list by=title); default the cursor's / line" } },
    examples: [{ act: 'edit.run line="ext.structure.sort-list order=desc"', does: "saves the edit and sorts the note's list, last first" }],
    async run({ line }, { surface, host }, actor) {
      const d = surface.draft;
      if (!d) throw new ActionRefused("nothing is being edited here");
      if (d.busy) throw new ActionRefused("the save is still landing");
      const here = line === undefined ? actionHereAt((d.lines[d.row] ?? ""), (d.lines[d.row] ?? "").length, d.lines, d.row) : null;
      const typed = line ?? (here ? (d.lines[d.row] ?? "").slice(here.start + 1) : null);
      if (!typed?.trim()) throw new ActionRefused("the cursor isn't on a / line · ctrl+k or / first on a line lists the actions here");
      const req = actRequestOf(lineWords(typed.trim()));
      const dispatch = host.ctx.dispatch, info = dispatch?.list().actions.find(a => a.name === req.action);
      if (!dispatch || !info) throw new ActionRefused(`no action ${req.action} here · / lists the ones that apply`);
      // What the host binds, from here: this note (an agent's run reaches it as the person's does), and that its
      // arguments were asked in place, so what's left out takes its default instead of a form over the note.
      const blockId = d.blockId;
      req.args = { ...(info.args.block?.context && req.args?.block === undefined && blockId ? { block: blockId } : {}), ...(info.args.asked?.context ? { asked: true } : {}), ...req.args };
      // The / line goes before the save: what's saved is the note as written, never the command.
      // Checked before anything moves (a value it doesn't take, a note it can't act on): the line stays to correct.
      const refused = dispatch.refusedNow(req, actor);
      if (refused) throw new ActionRefused(`${refused} · the line stays: correct it and ⏎ again`);
      const row = d.row, before = d.text, command = d.lines[row] ?? "";
      if (here) {
        surface.drafting!.replace(d.lines.filter((_, i) => i !== row).join("\n"), actor);
        d.place(Math.min(row, d.lines.length - 1), 0);
      }
      // Capture first: a save that didn't land keeps the edit as it was typed, its / line too, with why.
      const saved = d.dirty ? await saveDraft(surface, host, actor).catch((e: Error) => e) : (surface.closeDraftAction(false), null);
      if (surface.draft) {
        if (here && surface.draft === d) { surface.drafting!.replace(before, actor); d.place(row, command.length); }
        throw new ActionRefused(saved instanceof Error ? saved.message : d.note || "the edit didn't save, so the action didn't run");
      }
      try {
        const answer = await dispatch.as(actor, req);
        host.redraw();
        return { ran: actionLine(req), answer };
      } catch (e) {
        // Refused as it ran (an agent's act throws; the person's press says it): the edit opens again with the line.
        if (here) {
          const { draft: again } = await surface.ensureDraft(host);
          again.place(Math.min(row, again.lines.length), 0);
          again.pasteText(command + "\n", actor);
          again.place(row, command.length);
          host.redraw();
        }
        throw e;
      }
    },
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
    examples: [
      { act: "edit.close", does: "closes the edit when nothing is unsaved" },
      { act: "edit.close discard=true", does: "closes the edit even with unsaved changes, putting them aside as unsent" },
    ],
    run({ discard }, { surface, host }, actor) {
      const r = surface.closeDraftAction(!!discard);
      // Put aside (or dropped, when it was brought back and left unchanged): said where, and how it comes back.
      if (r.said && actor.kind === "user") host.ctx.flash(r.said, 8000);
      host.redraw();
      return r;
    },
  }),
  "session.leave": def({
    summary: "leave the edit or comment: an unchanged edit closes; a changed one is saved against its revision, or kept as unsent (e brings it back) when the save is refused; a comment or reply is kept as unsent, never sent. The person's own edit or comment stays open when they click or move elsewhere (PIE-785, PIE-812); this is what going elsewhere does to an agent's edit they're in. An agent leaves only a session it opened",
    keys: "a click outside an agent's edit you're in, or ^W then a window key (desk)",
    touches: "draft", draft: "leave", replay: "ask",
    args: {},
    run: (_, { surface, host }, actor) => surface.leave(host, actor),
  }),
  "page.create": def({
    summary: "make the page a [[address]] names when nothing answers it yet (address=, or the selected link's): `X [page::X]` where new notes go (the outline's placement rule: today the top of the Inbox), then open it as the link would; a page there already is opened. Following a missing [[page]] offers this first (⏎ or a click on it again). An agent's makes it, attributed and said, and opens nothing",
    keys: [{ keys: "⏎ click", does: "on a [[missing page]] link, twice (the first offers it)" }],
    touches: "nothing", replay: "ask",
    says: out => (out?.said ? `· ${out.said}` : null),
    args: { address: { type: "string", optional: true, about: "the page's address (its name); default: the selected link's" } },
    examples: [
      { act: "page.create address=seed-swap", does: "makes the page seed-swap where new notes go, then opens it" },
      { act: "page.create", does: "makes the page the selected [[link]] names, then opens it" },
    ],
    async run({ address }, { surface, host, standing }, actor) {
      const page = address ?? surface.selectedPage();
      if (!page) throw new ActionRefused("name the page: address=<its name>, or select a [[page]] link first");
      return surface.createPage(page, host, actor, standing);
    },
  }),
  "link.select": def({
    summary: "select the note's nth link (1 is the first); element.select picks any element a reader draws", keys: "[ ] (on a link)",
    touches: "tile", replay: "safe", way: "an agent selects a link in a reader the person isn't in, or follows one by number (link.follow n=)",
    args: { n: { type: "number", about: "which link, from 1" } },
    examples: [
      { act: "link.select n=2", does: "selects the note's second link, as the [ ] keys would" },
    ],
    run({ n }, { surface, host }) { surface.requireNote(); surface.selectLink(n - 1); host.redraw(); return surface.describe().links[n - 1]; },
  }),
  "link.follow": def({
    summary: "follow the selected link (or the nth); where it opens is the view's call; fresh=true opens it in a new reader", keys: "enter, alt+enter, click on a link",
    touches: "tile", replay: "ask", way: "following a link there would move what they're reading · an agent follows one in another reader (tile=), or opens the note with open id= naming no tile (it lands where opens land)",
    args: {
      ref: { type: "string", optional: true, about: "a link drawn in a snippet: ((id)), [[page]], a URL or #tag" },
      n: { type: "number", optional: true, about: "which link, from 1; default the selected one" },
      fresh: { type: "boolean", optional: true, about: "open it in a new reader (a new detail on the board), as alt+enter does" },
    },
    examples: [
      { act: "link.follow n=1", does: "opens the note's first link where the view opens links" },
      { act: "link.follow n=2 fresh=true", does: "opens the note's second link in a new reader" },
    ],
    async run({ n, fresh, ref }, { surface, host, standing }, actor) {
      surface.requireNote();
      // While the person's comment is unsent here, they're asked first (PIE-785).
      const asked = surface.askLeave("link.follow", { ...(ref !== undefined ? { ref } : {}), ...(n !== undefined ? { n } : {}), ...(fresh ? { fresh } : {}) }, actor, host);
      if (asked) return asked;
      if (ref !== undefined) {
        const link = linkOfRef(ref);
        if (!link) throw new ActionRefused(`${ref} isn't a link`);
        const m = await surface.followFromDraft(link, host);
        return m && "id" in m ? { opened: m.id, title: subject(m) } : { opened: null, ...(m ?? {}) };
      }
      // The person's n= becomes their [ ] position; an agent's follows that link and leaves the position alone.
      if (n !== undefined && standing) surface.selectLink(n - 1);
      const links = surface.describe().links;
      if (n !== undefined && !links[n - 1]) throw new ActionRefused(`there is no link ${n}; the note has ${links.length}`);
      const i = n !== undefined && !standing ? n - 1 : links.findIndex(l => l.selected);
      if (i < 0) throw new ActionRefused("no link is selected; pass n");
      const m = await surface.followLink(i, host, !!fresh);
      // Outside the door (a web page, a file): the person's opened there; an agent's is given the address.
      if (m && "outside" in m) return { opened: null, ...m };
      // A #tag (PIE-800): the list it opened (or, for an agent, the notes carrying it).
      if (m && "query" in m) return { opened: null, ...m };
      if (m) surface.noteAgent(actor, `followed a link to ${subject(m)}`);
      return m ? { opened: m.id, title: subject(m) } : { opened: null };
    },
  }),
  "elements": def({
    summary: "list what [ ] steps through in this reader, in reading order: links, figure rows, embeds, comment marks (the current one marked)",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { surface }) {
      await surface.whole();
      surface.requireDrawn();
      return { elements: surface.describeElements() };
    },
  }),
  "element.scroll": def({
    summary: "scroll the inline list containing element n, passing the wheel to the note at its ends",
    touches: "tile", replay: "safe", person: "the list's scroll belongs to the person", keys: "wheel over an inline list",
    args: { n: { type: "number", about: "an element in the list" }, by: { type: "number", about: "rows to scroll" } },
    examples: [{ act: "element.scroll n=2 by=3", does: "scrolls the inline list containing the second element down three rows" }],
    run({ n, by }, { surface, host }) { surface.scrollInline(n, by); host.redraw(); return {}; },
  }),
  "element.select": def({
    summary: "put the person's [ ] position on the nth element (elements lists them), or by=1 / by=-1 the next or previous one (from the view when none is current); n=0 lets go of it. row= picks a row inside that element's inline list. The reading ruler follows. An agent's is refused: the position is the person's (block.tint marks something for them)", keys: [{ keys: "[ ]", does: "the previous or next element" }, { keys: "click", does: "an element" }, { keys: "esc", does: "lets go", says: "let go of the element you are on" }],
    touches: "tile", replay: "safe", person: "the [ ] position is the person's; block.tint marks a block for them without moving it",
    args: {
      n: { type: "number", optional: true, about: "which element, from 1, as elements lists them; 0 lets go" },
      row: { type: "number", optional: true, about: "row within this inline list, from 1" },
      by: { type: "number", optional: true, about: "1 the next element, -1 the previous one" },
    },
    examples: [
      { act: "element.select n=3", does: "puts the [ ] position on the note's third element" },
      { act: "element.select by=1", does: "steps the [ ] position to the next element" },
      { act: "element.select n=2 row=5", does: "selects the fifth row of the note's second element, an inline list, and previews it" },
    ],
    async run({ n, by, row }, { surface, host }, actor) {
      if ((n === undefined) === (by === undefined)) throw new ActionRefused("say n= (an element, 0 lets go) or by=1 / by=-1");
      if (n === 0) { surface.letGo(); host.redraw(); return { current: null }; }
      if (by !== undefined) {
        if (!surface.step(by < 0 ? -1 : 1)) throw new ActionRefused("nothing to step to: this note has no links, folds, figure rows, embeds, resource projections or comments");
        surface.previewRow(host);
        host.redraw();
        return surface.describeElements().find(e => e.current) ?? null;
      }
      await surface.whole();
      if (row !== undefined && (!Number.isInteger(row) || row < 1)) throw new ActionRefused("row must be a whole number from 1");
      const selected = row !== undefined ? surface.selectInlineRow(surface.element(n!), row - 1) : null;
      if (!selected) surface.selectElement(surface.element(n!));
      surface.previewRow(host);
      host.redraw();
      return selected ?? surface.describeElements()[n! - 1];
    },
  }),
  "button.pin": def({
    summary: "pin to status bar: append this note's selected ::button to your [status-bar::true] note; label= picks a button by its exact label, or a note with one button needs no selection",
    touches: "nothing", replay: "ask",
    args: { label: { type: "string", optional: true, about: "the exact label of the ::button to pin; default: selected button, or the note's only one" } },
    keys: [{ via: "a right-click on a button (it becomes the [ ] position, unpressed), then pin to status bar in the tile menu" }],
    examples: [{ act: 'button.pin label="Collapse"', does: "pins the Collapse button from this note to your status bar" }],
    // In the Button group, the menu's first (PIE-1428): about the button the right-click landed on.
    menu: { ...noteRow("pin to status bar", "", { now: ({ surface }) => surface.statusButtonLine() ? null : { hide: true } }), group: BUTTON_GROUP },
    async run({ label }, { surface, host }, actor) {
      await surface.whole();
      const line = surface.statusButtonLine(label);
      if (!line) throw new ActionRefused("select one ::button with [ ], or say button.pin label=<its exact label>");
      return host.ctx.dispatch!.act({ action: "status.bar.pin", args: { line } }, actor);
    },
  }),
  "button.press": def({
    summary: "press a button or a pressable square of a view in this note by its label (or n from elements): a button runs its ordered action taps and script pipe stages as one undo group over reversible effects; a view square runs its action line. The dispatcher attributes whoever asks, and the first sequence failure reports the step and effects that remain. It opens nothing and moves nothing the person is reading, so it works on the reader they hold; tile= names another reader, and note=<id> presses a ::button, an [label](act: …) link or a control a render script drew (a view's button, badge, card or row, from the service's projection) in a note that is open nowhere, with no focus moved",
    keys: "a click on a button, or ⏎ on it (element.open does the same)", touches: "nothing", replay: "ask",
    args: {
      label: { type: "string", optional: true, about: "the button's label, or part of it (`Fantasia` finds `✦ Fantasia`); the one pressable element that has it" },
      alt: { type: "boolean", optional: true, about: "run the button's alt= action, as alt+click does" },
      n: { type: "number", optional: true, about: "which element, from 1 (elements lists them), when it is a pressable one" },
      line: { type: "number", optional: true, about: "source line from 1, with note=, to press a specific button when labels repeat" },
      note: { type: "string", optional: true, about: "a note to press a button of by its label, whether or not it is open anywhere (a block id or its first 8+ characters, a Work ID or a [[page]]): a ::button, a link, or a control its render script drew; the button's script acts on that note" },
    },
    examples: [
      { act: "button.press label=Water", does: "presses the Water button of this note, as whoever asks" },
      { act: 'button.press note=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 label="Water beds"', does: "presses that button of a note open nowhere, moving no focus" },
    ],
    async run({ label, n, note, alt, line }, { surface, host }, actor) {
      if (note !== undefined) {
        if (label === undefined) throw new ActionRefused("note= needs label= (the button's words); open the note in a reader and use elements for n=");
        // Its first 8+ characters, a Work ID or a [[page]] too, as open id= takes them (PIE-1428): the one resolver, readNote's.
        const m = await readNote(host.ctx, note);
        if (!m) throw new ActionRefused(`no note ${note}: button.press note= takes a note's id, its first 8+ characters, a Work ID or a [[page]]`);
        const found: { label: string; act: string; alt?: string; line: number }[] = [];
        for (const c of buttonCallsOf(m.text)) if (c.act || c.problem) found.push({ label: c.label, act: c.act ?? "", alt: c.alt, line: c.line });
        m.text.split("\n").forEach((l, line) => { if (!l.includes("](act:")) return; for (const o of linkOccurrences(l)) if (o.kind === "markdown") { const act = /^act:\s*(\S.*)$/.exec(o.url.trim())?.[1]?.trim(); if (act) found.push({ label: o.text, act, line }); } });
        const want = label.toLowerCase();
        const matching = (list: typeof found) => {
          const exact = list.filter(f => f.label.toLowerCase() === want);
          return (exact.length ? exact : list.filter(f => f.label.toLowerCase().includes(want))).filter(f => line === undefined || f.line === line - 1);
        };
        // Controls a render script drew on the note (a view's button, badge, card or row) are the service's projection of it, so a note open
        // nowhere has them too. Lines still being drawn are waited for (the read itself asks the service to draw them), so which
        // line answers a label never depends on which finished first.
        if (!matching(found).length && mayHaveProjections(m.text)) {
          for (const end = Date.now() + 10_000; ;) {
            const read = await host.ctx.board.readResourceProjections(m.id).catch(() => null);
            if (!read) break;
            const drawn = drawnPresses(read);
            if (!drawingPending(read) || Date.now() > end) { found.push(...drawn.filter(d => !found.some(f => f.act === d.act && f.line === d.line && f.label === d.label))); break; }
            await Bun.sleep(150);
          }
        }
        const hits = matching(found);
        if (!hits.length) throw new ActionRefused(`no button says "${label}" in that note; it has ${found.length ? found.map(f => `"${f.label}"`).join(", ") : "none"}. Example: button.press note=${m.id.slice(0, 8)} label="${found[0]?.label ?? "Review"}"`);
        if (hits.length > 1) throw new ActionRefused(`"${label}" matches ${hits.length} buttons of that note (${hits.map(f => `"${f.label}"`).join(", ")}); say more of the label`);
        const hit = hits[0]!, act = alt && hit.alt ? hit.alt : hit.act;
        const r = await surface.runPress({ act, block: m.id, line: hit.line, label: hit.label }, host, actor, !!alt && !hit.alt);
        surface.noteAgent(actor, `pressed ${hit.label} (${act})`);
        return { note: m.id, kind: "control", act, ...(r && typeof r === "object" ? r : {}) };
      }
      await surface.whole();
      surface.requireDrawn();
      if ((label === undefined) === (n === undefined)) throw new ActionRefused("say label= (the button's words) or n= (its number in elements)");
      const all = surface.describeElements();
      const pressable = (i: number) => { const e = surface.element(i + 1); return e.kind === "control" && !!e.link?.press; };
      let hits = n !== undefined ? (n >= 1 && n <= all.length && pressable(n - 1) ? [n] : []) : all.map((_, i) => i + 1).filter(i => pressable(i - 1) && all[i - 1]!.label.toLowerCase().includes(label!.toLowerCase()));
      const exact = hits.filter(i => all[i - 1]!.label.replace(/^\[|\]$/g, "").toLowerCase() === label?.toLowerCase());
      if (exact.length) hits = exact;
      if (!hits.length) {
        const have = all.map((e, i) => ({ e, i: i + 1 })).filter(x => pressable(x.i - 1)).map(x => `${x.i}: ${x.e.label}`);
        throw new ActionRefused(`${n !== undefined ? `element ${n} is not a button` : `no button says "${label}"`} in this note; ${have.length ? `it has ${have.join(", ")}` : "it has none (a button is ::button{label=… act=…} or a view's pressable square)"}. Example: button.press label="${(have[0]?.split(": ")[1] ?? "Review").replace(/^\[|\]$/g, "")}"`);
      }
      if (hits.length > 1) throw new ActionRefused(`"${label}" matches ${hits.length} buttons (${hits.map(i => `${i}: ${all[i - 1]!.label}`).join(", ")}); say n=`);
      const i = hits[0]!, e = surface.element(i), p = e.link!.press!;
      const act = alt && p.alt ? p.alt : p.act;
      const r = await surface.runPress({ ...p, act }, host, actor, !!alt && !p.alt);
      surface.noteAgent(actor, `pressed ${e.label} (${act})`);
      return { element: i, kind: e.kind, act, ...(r && typeof r === "object" ? r : {}) };
    },
  }),
  "button.slot": def({
    words: "write one slot of a button's sequence",
    summary: "write one slot of a ::button onto its line (PIE-1298): `::button{act=\"tile.zoom tile={target}\" target=}` runs once target= says a tile. The note's checked save, recorded as whoever asks; ctrl+z (sources.undo) takes it back. A tile is kept as its id (t-<uuid>, exactly that tile) or the address of its place (drawer.agent, role:<role>, <slot>@<screen>: whichever tile fills it), never a number. The person, with no value=, is asked (the wire picker for a tile: click one); an agent passes value= and never opens the picker",
    keys: [{ keys: "click", does: "a button with an empty slot, then click a tile" }, { keys: "alt-click", does: "a button with a slot to choose again" }], touches: "nothing", replay: "ask",
    args: {
      note: { type: "string", optional: true, about: "the note the button is written in (a block id; default the one shown)" },
      line: { type: "number", optional: true, about: "the line of the button, from 1 (the note's text; with note=)" },
      label: { type: "string", optional: true, about: "or: the button's label (or part of it)" },
      key: { type: "string", optional: true, about: "the slot (the word on the line a {key} fills); default the first empty one" },
      value: { type: "string", optional: true, about: "what it holds: a tile's name, id or drawer.agent; a note's id; any text. Left out, the person is asked" },
      ask: { type: "boolean", optional: true, about: "after this, ask for the next empty slot of the same button (the person's)" },
      next: { type: "string", optional: true, about: "after this, ask for these slots of the same button, in order (key,key: a re-pick of filled ones)" },
      run: { type: "boolean", optional: true, about: "after the last slot is answered, press the button (the person's press that asked for them)" },
    },
    examples: [
      { act: 'button.slot label="pop it" key=target value=drawer.agent', does: "writes target=drawer.agent on the pop it button, so its next press lifts the drawer's agent" },
      { act: "button.slot line=3 key=target", does: "asks the person to choose the tile again for the button on line 3" },
    ],
    run: (a, { surface, host }, actor) => surface.setButtonSlot(a, host, actor),
  }),
  "element.open": def({
    summary: "do what enter does on an element: a link follows (where is the view's call), a fold toggles, a row or an embed opens its note, a comment mark opens its thread; fresh=true opens a link, row or embed in a new reader. An agent's leaves the person's [ ] position alone, is refused in the reader they have, and never opens the browser (it is given the address)", keys: "enter, alt+enter, a click",
    touches: "tile", replay: "ask", way: "opening an element there would move what they're reading · an agent opens one in another reader (tile=), opens the note with open id=, or folds a section with fold or unfold",
    args: {
      n: { type: "number", optional: true, about: "which element, from 1 (elements lists them); default the current one (the person's own only)" },
      row: { type: "number", optional: true, about: "row within this element's inline list, from 1" },
      fresh: { type: "boolean", optional: true, about: "open it in a new reader (a new detail on the board), as alt+enter does" },
    },
    examples: [
      { act: "element.open n=2", does: "opens the note's second element, as enter does on it" },
      { act: "element.open n=2 fresh=true", does: "opens the second element, a link, row or embed, in a new reader" },
    ],
    async run({ n, fresh, row }, on, actor) {
      const { surface, host, standing } = on;
      // The person's key or click is on what's drawn now: no wait for the whole note.
      if (!standing) await surface.whole();
      if (n === undefined && !standing) throw new ActionRefused("say which element: n (elements lists them); the current one is the person's");
      const cur = standing ? surface.inView() : null;
      const i = n ?? (cur ? surface.describeElements().findIndex(e => e.current) + 1 : 0);
      if (!i) throw new ActionRefused("no element is current in view; pass n");
      if (row !== undefined && (!Number.isInteger(row) || row < 1)) throw new ActionRefused("row must be a whole number from 1");
      const e = row === undefined ? surface.element(i) : surface.inlineRowElement(surface.element(i), row - 1);
      // A code block or a quote has nothing to open: ⏎ copies it (the person's to their clipboard, an agent's returned).
      if (e.kind === "block") { const r: unknown = await NOTE_ACTIONS.run("block.copy", { n: e.block! + 1 }, on, actor); return r; }
      if (fresh && e.kind !== "link" && e.kind !== "row" && e.kind !== "embed" && !e.link?.press?.alt) throw new ActionRefused(`fresh opens a link, a row or an embed; element ${i} is a ${e.kind}`);
      // Going elsewhere while the person's comment is unsent here asks them first (PIE-785).
      if (e.kind === "link" || e.kind === "row" || e.kind === "embed" || e.kind === "comment") {
        const asked = surface.askLeave("element.open", { n: i, ...(row !== undefined ? { row } : {}), ...(fresh ? { fresh } : {}) }, actor, host, e.key);
        if (asked) return asked;
      }
      // A step's box opens the person's status choice; an agent sets the status itself.
      // A live figure's tab or density control: the figure's own action, with its rules and its provenance.
      if (e.kind === "figure" && e.link?.figure) {
        return surface.runFigureControl(e.link.figure, host, actor);
      }
      if (e.kind === "task" && !standing) throw new ActionRefused(`element ${i} is a step's status control; an agent sets it with task.status n=… to=done|todo|waiting|problem|approved|rejected (tasks lists the steps)`);
      // An extension's line (PIE-512): its head runs the line's primary action, a control its own; an agent's
      // run is the agent's (said on the status bar), and what it writes is the extension's (ext:<id>).
      if (e.link?.ext && !e.link.press && (e.kind === "control" || e.kind === "resource")) {
        const r = await surface.runExt(e.link.ext.action, e.link.ext, host, actor);
        surface.noteAgent(actor, `ran ${e.link.ext.action} on ${e.label}`);
        return { element: i, kind: e.kind, action: e.link.ext.action, ...(r && typeof r === "object" ? r : {}) };
      }
      // A press (PIE-957): its action line, through the door's dispatcher, as whoever asks (the person's asks first when it writes).
      if (e.link?.press && e.kind === "control") {
        const act = fresh && e.link.press.alt ? e.link.press.alt : e.link.press.act;
        const r = await host.ctx.dispatch!.act({ action: "button.press", args: { n: i, ...(fresh ? { alt: true } : {}) }, ...(messageContext.getStore()?.tile ? { tile: messageContext.getStore()!.tile } : {}) }, actor);
        surface.noteAgent(actor, `pressed ${e.label} (${act})`);
        return { element: i, kind: e.kind, act, ...(r && typeof r === "object" ? r : {}) };
      }
      // An `■ unsent` line's control runs its action as whoever asks (an agent's is refused: the unsent text is the person's).
      if (e.kind === "control" && e.link?.unsent) {
        const r: unknown = await NOTE_ACTIONS.run(`unsent.${e.link.unsent.op}`, { kind: e.link.unsent.kind }, on, actor);
        return { element: i, kind: e.kind, ...(r && typeof r === "object" ? r : {}) };
      }
      // A proposal's [apply] [dismiss] run its action as whoever asks, attributed to them.
      if (e.kind === "control" && e.link?.proposal?.op) {
        const r: unknown = await NOTE_ACTIONS.run(`proposal.${e.link.proposal.op}`, { id: e.link.proposal.id }, on, actor);
        return { element: i, kind: e.kind, ...(r && typeof r === "object" ? r : {}) };
      }
      // A `::fields` row's ¶ anchors its line, as whoever asks.
      if (e.link?.anchor) {
        const r: unknown = await NOTE_ACTIONS.run("fields.anchor", { key: e.link.anchor.key, n: e.link.anchor.n }, on, actor);
        return { element: i, kind: e.kind, ...(r && typeof r === "object" ? r : {}) };
      }
      // A `::use` that needs a prop: an agent names them (use.fill with=); the person is asked.
      if (e.link?.use && !standing) throw new ActionRefused(`that's a ::use that needs a prop: an agent gives it with use.fill block=${e.link.use.block} line=${e.link.use.line + 1} with='{"name":"value"}'`);
      // An expanded thread's controls are the person's view of it; an agent acts on the thread itself.
      if (e.kind === "control" && !standing) throw new ActionRefused(`that's the person's ${e.control} control on ${e.control === "card" ? "a margin card" : "an expanded thread"}; an agent uses ${e.control === "select" ? "select text=…" : e.control === "reply" ? `reply thread=${e.thread!.slice(0, 8)} body=…` : e.control === "edit" ? `comment.edit thread=${e.thread!.slice(0, 8)}${e.value ? ` reply=${e.value.slice(0, 8)}` : ""} body=…` : e.control === "card" ? "threads, or reply" : e.control === "quote" ? `quote threads=${(e.value ?? e.thread!).slice(0, 8)} where=inbox` : e.control === "quoted" ? `open id=${e.value ?? ""}` : e.control === "untldr" || e.control === "tldr" ? `thread.tldr thread=${e.thread!.slice(0, 8)}${e.control === "untldr" ? " remove=true" : ""}` : `resolve thread=${e.thread!.slice(0, 8)} (open=true reopens)`}`);
      // An agent's comment mark opens the thread list as its own session, on that thread (never under the
      // person's property panel, which would take the keys meant for it).
      if (e.kind === "comment" && !standing) {
        if (surface.panel && !surface.draft && !surface.session) throw new ActionRefused("the person has the property panel open on this note; try again once they close it");
        const r = await NOTE_ACTIONS.run("threads", {}, on, actor) as { threads: { id: string }[] };
        const s = surface.session;
        const t = s ? s.threads.findIndex(x => x.id === e.thread) : -1;
        if (s && t >= 0) s.sel = t;
        host.redraw();
        return { thread: e.thread, ...r };
      }
      const r = await surface.openElement(e, host, !!fresh, standing, actor);
      // Outside the door, an agent's was given the address (openOutside said so); it opened nothing.
      if (!(r && typeof r === "object" && "outside" in r)) surface.noteAgent(actor, `${e.kind === "fold" ? "toggled" : "opened"} ${e.label}`);
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
    examples: [
      { act: "block.tint line=3 to=5", does: "tints lines 3 to 5 of the note and scrolls them into view" },
      { act: 'block.tint quote="mulch the beds"', does: "tints those exact words, naming who marked them" },
    ],
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
    summary: "fetch the tickets a note shows now (a page's, or the ticket block's own), and run its extensions' lines again (PIE-507): block=<id> (line=<index> for one line: an output, a component, an @name request is asked again, a record fetched), else the one the [ ] position is on, else the note's (its tickets; its one line that runs, when it has one). A note with several lines that run (handler lines, components, @name requests) and no position is refused naming them: none runs (PIE-956). Who runs it is who asked (an @name line says so). The service runs them and writes as the extension; the region repaints", keys: "r, a click on a ticket's age or on a line's run again control (behind its gutter mark)",
    touches: "nothing", replay: "ask",
    args: {
      block: { type: "string", optional: true, about: "the block whose tickets and lines to fetch or run (a page or a ticket block); default: the reader's" },
      line: { type: "number", optional: true, about: "only that line (its index in the note's text, 0 the first), of block= or else the reader's note" },
    },
    examples: [
      { act: "projection.refresh", does: "fetches the tickets the note shows now and repaints them" },
      { act: "projection.refresh block=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 line=4", does: "runs line 4 of that note again, counting from 0" },
    ],
    async run(a, { surface, host }, actor) {
      const m = surface.msg;
      const t = typeof a.block === "string" && a.block ? { block: a.block, ...(a.line !== undefined ? { line: a.line } : {}) }
        : m && isOutlineNote(m) ? (a.line !== undefined ? { block: m.id, line: a.line } : refreshOf(surface, host, actor)) : null;
      if (!t) throw new ActionRefused("no note with tickets here");
      return surface.refreshTickets(host, t.block, actor, t.line);
    },
  }),
  "up": def({
    summary: "go to the note's parent. An agent's is refused on the reader the person has", keys: "u (U too in the message reader)",
    touches: "tile", replay: "safe", way: "up would move what they're reading · an agent goes up in another reader (tile=), or opens the parent with open id=",
    menu: noteRow("up to the parent", "u", { busy: true }),
    args: {},
    async run(_, { surface, host, standing }, actor) {
      if (standing) surface.letGo();
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
    async run(_, { surface, host, standing }, actor) {
      const m = surface.msg;
      if (!m) throw new ActionRefused("no note here to show the links of");
      if (!isOutlineNote(m)) throw new ActionRefused("a resource or a file isn't a block: it has no links here");
      if (!host.links) throw new ActionRefused("this screen has no room for a links tile · write ::links in a note to list them inline");
      return host.links(actor, standing);
    },
  }),
  "back": def({
    summary: "go back to the note this reader showed before it followed a link, went up, or had a note opened into it (an agent's open too), scrolled and with its [ ] position as it was. An agent's is refused on the reader the person has focused",
    keys: [{ keys: "alt+← alt+b backspace", does: "back" }, { via: "the mouse's back button" }, { keys: "click", does: "on ← back" }],
    touches: "tile", replay: "safe", way: "back would move what they're reading · an agent goes back only in another reader (name it with tile=)",
    menu: noteRow("back", "alt+left", { busy: true, now: ({ surface }) => (surface.describeHistory().back.length ? null : { hide: true }) }),
    args: { steps: STEPS_ARG },
    examples: [{ act: "back steps=2", does: "goes back two stops on the trail at once, as two backs would" }],
    run: ({ steps }, on, actor) => travelAction(-1, on, actor, steps),
  }),
  "forward": def({
    summary: "go forward again to where back came from, scrolled and with its [ ] position as it was. An agent's is refused on the reader the person has focused",
    keys: [{ keys: "alt+→ alt+f", does: "forward" }, { via: "the mouse's forward button" }, { keys: "click", does: "on forward →" }],
    touches: "tile", replay: "safe", way: "forward would move what they're reading · an agent goes forward only in another reader (name it with tile=)",
    menu: noteRow("forward", "alt+right", { busy: true, now: ({ surface }) => (surface.describeHistory().forward.length ? null : { hide: true }) }),
    args: { steps: STEPS_ARG },
    examples: [{ act: "forward steps=2", does: "goes forward two stops on the trail at once" }],
    run: ({ steps }, on, actor) => travelAction(1, on, actor, steps),
  }),
  "trail": def({
    summary: "the trail of where this reader has been (PIE-208): every stop back and forward by its title, nearest first, the note shown between them. The person's opens it as a trail tile beside the reader (PIE-1425: docked, resized and closed like any tile; alt+T again goes back to it), or a list over a screen without tiles: ⏎ or a click on a stop goes there (back or forward that many steps, as back steps= does), esc closes it. An agent's answers the stops and opens nothing",
    keys: "alt+T, a click on ≡ trail beside ← back",
    touches: "nothing", replay: "safe",
    menu: noteRow("trail: where it's been", "alt+T", { busy: true, now: ({ surface }) => { const h = surface.describeHistory(); return h.back.length || h.forward.length ? null : { hide: true }; } }),
    args: {},
    examples: [{ act: "trail", does: "lists the stops back and forward; back steps=2 then goes to the second one back" }],
    run: (_, { surface, host, standing }) => surface.trail(host, standing),
  }),
  "element.zoom": def({
    summary: "zoom this reader into a part of its note (PIE-780): the figure, table, heading's section, callout, list item or paragraph at line= (from 1; default the [ ] position's, else the reading line's), or anchor=, fills the tile, interactive at full size, the part element.detach would take there (the service says which lines). Where it was goes on its back trail: on=false, esc, back or a click on ← back returns to the whole note as it was; forward zooms in again. An agent's is refused on the reader the person has focused",
    keys: ZOOM_KEYS.map(k => k.key === "click" ? "a click on a part's ⤢" : `${keyCaption(k.key)}${k.args?.on === false ? " (zoomed)" : ""}`).join(", "),
    touches: "tile", replay: "safe", way: "zooming would change what they're reading · an agent zooms only in another reader (name it with tile=)",
    says: r => (r as { zoomed?: { label: string } }).zoomed ? `zoomed into ${(r as { zoomed: { label: string } }).zoomed.label}` : "back to the whole note",
    menu: noteRow("zoom into this part", "W", { busy: true, now: ({ surface }) => (!surface.msg || !isOutlineNote(surface.msg) ? { hide: true } : null) }),
    args: {
      line: { type: "number", optional: true, about: "a line of the part, in the note from 1 (default: the [ ] position's, else the reading line's)" },
      anchor: { type: "string", optional: true, conflicts: ["line"], about: "the part's ^anchor, when it has one" },
      on: { type: "boolean", optional: true, about: "false steps back out of the zoom (to the part it was zoomed from, else the whole note); left out, zooms in, inside a zoomed part too" },
    },
    examples: [
      { act: "element.zoom line=4", does: "fills the reader with the figure (or table, or section) on line 4 of its note" },
      { act: "element.zoom anchor=bed-jobs", does: "zooms into the part anchored ^bed-jobs" },
      { act: "element.zoom on=false", does: "returns the reader to the whole note, scrolled as it was" },
    ],
    async run({ line, anchor, on }, { surface, host }, actor) {
      if (on === false) {
        const why = await surface.unzoom(host, actor);
        if (why) throw new ActionRefused(why);
        surface.noteAgent(actor, "went back to the whole note");
        return { zoomed: null, history: surface.describeHistory() };
      }
      if (line !== undefined && (!Number.isInteger(line) || line < 1)) throw new ActionRefused("line= is a line of the note, from 1");
      const z = await surface.zoomInto({ ...(line !== undefined ? { line: line - 1 } : {}), ...(anchor !== undefined ? { anchor: String(anchor) } : {}) }, host);
      surface.noteAgent(actor, `zoomed into ${z.label}`);
      return { zoomed: { kind: z.kind, label: z.label, lines: [z.start + 1, z.end + 1], ...(z.anchor ? { anchor: z.anchor } : {}) }, history: surface.describeHistory() };
    },
  }),
  "passage.select": def({
    summary: "start a comment: pick a passage of the note's source text by its exact words (default: the first line with text). The person's C writes on the words they selected (as a c does); with nothing selected C writes on the whole note (comment.note, PIE-846)", keys: [{ keys: "C", does: "on selected words" }, { via: "an agent: quote=" }],
    touches: "draft", draft: "type", replay: "ask",
    // The menu's way to it is the person's words selected (PIE-846): with none, the menu offers the whole note instead.
    menu: noteRow("comment on the selected words", "C", { busy: true, now: on => (on.surface.selection ? null : { hide: true }) }),
    args: {
      quote: { type: "string", optional: true, about: "the exact words to quote, as stored" },
      near: { type: "number", optional: true, about: "when the words occur more than once: the offset to be nearest" },
    },
    examples: [
      { act: 'passage.select quote="mulch the beds"', does: "picks those words of the note to write a comment on" },
      { act: "passage.select quote=beds near=120", does: "picks the occurrence of beds nearest offset 120 to comment on" },
    ],
    async run({ quote, near }, { surface, host }, actor) {
      // The person's C starts from their selected text (the quote) and their put-aside comment; an agent's never.
      const s = actor.kind === "user" && !surface.session && !surface.draft ? await personComments(surface, host, "select") : await surface.ensureSession(host, "select", actor);
      // From the passage toolbar (Comment, Ask): already writing on the selected words.
      if (s.mode === "compose" && s.target?.kind === "quote" && quote === undefined) { host.redraw(); return { revision: s.msg.revision, quote: s.target.passage.quote, start: s.target.passage.start, writing: true }; }
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
    summary: "write the comment (or reply) text: on a picked passage this is Enter, then the text. An agent's replaces only a comment it opened, never one the person is writing; invited (their @name line), it rewrites the text above that line, once", keys: [{ keys: "enter", does: "then typing" }],
    touches: "draft", draft: "text", replay: "ask",
    args: {
      body: { type: "string", about: "the comment's text" },
      invitation: { type: "string", optional: true, about: "the invitation the person's @name line gave this agent: body replaces the text above that line (one reply)" },
      base: { type: "string", optional: true, about: "with invitation=: the hash of the text the reply was written on, as the invitation gave it" },
    },
    examples: [
      { act: 'comment.write body="Which beds get it?"', does: "writes that as the comment on the picked passage, unsent" },
    ],
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
    summary: "after a send refused because the note moved on: find the quote again in the note's current text (nearest where it was), or pick the passage again when its words are gone; the comment's text stays", keys: modeActionKeys(ATTACHED_KEYS, "comment.reload"),
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
    summary: "send the comment or reply; a retry of the same text can't land twice", keys: modeActionKeys(ATTACHED_KEYS, "comment.send"),
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
    examples: [
      { act: 'comment quote="mulch the beds" body="Which beds get it?"', does: "comments on those words of the note and sends the comment" },
      { act: 'comment quote=beds near=120 body="Not the front one"', does: "comments on the occurrence of beds nearest offset 120 and sends it" },
    ],
    async run({ quote, body, near }, on, actor): Promise<unknown> {
      await NOTE_ACTIONS.run("passage.select", { quote, near }, on, actor);
      await NOTE_ACTIONS.run("comment.write", { body }, on, actor);
      return NOTE_ACTIONS.run("comment.send", {}, on, actor);
    },
  }),
  "comment.note": def({
    summary: "comment on the whole note, not a passage (PIE-846): the person's composer opens at the top of the note, where whole-note threads are (a comment put aside on the note comes back in it); body= sends it at once, as an agent's always is. Its thread sits at the top of the note, its card in the margin's first row",
    keys: [{ keys: "C", does: "with nothing selected" }, { keys: "click", does: "the byline's [comment]" }, { via: "the tile menu's \"comment on the whole note\"" }],
    touches: "draft", draft: "type", replay: "ask",
    menu: noteRow("comment on the whole note", "C", { busy: true }),
    args: { body: { type: "string", optional: true, about: "the comment's text, sent at once (left out, the person writes it)" } },
    examples: [
      { act: 'comment.note body="Please add dates to the plan"', does: "comments on the whole note and sends it at once" },
      { act: "comment.note", does: "opens the comment box at the top of the note for the person to write" },
    ],
    async run({ body }, { surface, host }, actor) {
      const m = surface.requireNote();
      if (!isOutlineNote(m) && !m.resource) throw new ActionRefused("this isn't a note or a Resource's text: nothing to comment on");
      if (body !== undefined && body.trim()) {
        if (m.revision === undefined) throw new ActionRefused("the outline didn't say which revision this note is at");
        const id = crypto.randomUUID();
        const r = m.resource ? await host.ctx.board.commentOnResource(id, m.resource, m.revision, body, null, actor) : await host.ctx.board.comment(id, m.id, m.revision, body, null, actor);
        await surface.loadComments(host);
        asActor(host.ctx, actor).flash("commented on the whole note");
        surface.noteAgent(actor, "commented on the whole note");
        host.redraw();
        return { thread: r.id, whole: true };
      }
      if (actor.kind !== "user") throw new ActionRefused("say body=: an agent's comment is sent at once");
      const why = await surface.commentOnNote(host, actor, host.still);
      if (!surface.session || surface.session.target?.kind !== "note") throw new ActionRefused(movedOn(host, surface, m.id) ?? (why || "the comment didn't open"));
      host.redraw();
      // restored: what was put aside on this note came back into it (a handover's restore checks it did).
      return { writing: "comment", whole: true, restored: !!surface.session.composer?.restored };
    },
  }),
  "passage.act": def({
    summary: "act on a passage (ADR 0004 contract 5): comment on it, ask the agent that answers in threads about it (its answer lands in the passage's margin thread), have it explained, or run an extension's passage action (marginalia's highlight, define, cite). The passage is exact source text: the words named with quote= (near= among repeats), else the actor's own selection (the person's for the person; an agent's own, never the person's). The service checks it before anything is written",
    keys: [{ keys: "a then c", does: "comment, while text is selected" }, { keys: "a then a", does: "ask", says: "ask the agent about the selected passage" }, { keys: "a then e", does: "explain", says: "have the selected passage explained" }, { keys: "a then h", does: "highlight", says: "highlight the selected passage" }, { keys: "a then d", does: "define", says: "define the selected passage" }, { keys: "a then k", does: "cite with marginalia" }, { keys: "click", does: "its chip on the selection's line" }],
    touches: "draft", draft: "type", replay: "ask",
    args: {
      action: { type: "string", about: "comment, ask, explain, or an extension's passage action by its name (ext.<id>.<action>; passage.choices lists them)" },
      quote: { type: "string", optional: true, about: "the exact words, as stored (default: your selection)" },
      near: { type: "number", optional: true, about: "when the words occur more than once: the offset to be nearest" },
      body: { type: "string", optional: true, about: "comment: its text, sent at once (left out, the person writes it)" },
      text: { type: "string", optional: true, about: "comment written by the person: what the composer starts with (a quote-reply's > lines); quote= then names the passage, without a selection" },
      question: { type: "string", optional: true, about: "ask: the question, sent at once (left out, the person writes it after @name)" },
      color: { type: "string", optional: true, about: "a theme tone the extension may use (highlight's colour): default, good, warn, bad, dim, accent" },
    },
    examples: [
      { act: 'passage.act action=comment quote="mulch the beds" body="Which beds get it?"', does: "comments on those words and sends the comment at once" },
      { act: 'passage.act action=ask quote="mulch the beds" question="Why mulch in March?"', does: "asks the thread agent about those words; its answer lands in the margin" },
    ],
    async run({ action, quote, near, body, question, color, text: start }, { surface, host }, actor) {
      const m = surface.requireNote();
      if (!isOutlineNote(m) && !m.resource) throw new ActionRefused("this isn't a note or a Resource's text: nothing to act on a passage of");
      const p = surface.passageFor(actor, quote, near);
      const said = asActor(host.ctx, actor);
      const send = async (text: string, props?: Record<string, string>) => {
        const id = crypto.randomUUID();
        const r = m.resource ? await host.ctx.board.commentOnResource(id, m.resource, m.revision!, text, p.note, actor, props) : await host.ctx.board.comment(id, m.id, m.revision!, text, p.note, actor, props);
        await surface.loadComments(host);
        if (actor.kind === "user") surface.selection = null;
        host.redraw();
        return r.id;
      };
      if (action === "comment" || action === "ask" || action === "explain") {
        const agent = action === "comment" ? null : threadAgents()[0];
        if (action !== "comment" && !agent) throw new ActionRefused("no agent here answers in comment threads: add marginalia (its @margin agent) or another whose agent says threads: true");
        const kind = action === "comment" ? undefined : action === "ask" ? "question" : "explain";
        const props = kind ? { kind } : undefined;
        const text = action === "explain" ? `@${agent!.name} explain this passage` : action === "ask" && question !== undefined ? `@${agent!.name} ${question}` : body;
        if (text !== undefined && text.trim()) {
          const thread = await send(text, props);
          said.flash(action === "comment" ? "commented on the passage" : `asked @${agent!.name} · the answer lands in the margin`);
          surface.noteAgent(actor, `${action === "comment" ? "commented on" : "asked about"} "${p.note.quote}"`);
          return { thread, passage: p.target };
        }
        // Written by hand: the comment composer on the passage, opened for the person (an agent says body= or question=).
        if (actor.kind !== "user") throw new ActionRefused(action === "ask" ? "say question=: an agent's question is sent at once" : "say body=: an agent's comment is sent at once");
        // As the person's C opens it (their session, entered as it opens), straight to writing on the selected words.
        surface.writeNext = { props: props ?? null, text: `${agent ? `@${agent.name} ` : ""}${start ?? ""}`, ...(quote !== undefined ? { at: { from: p.note.start, to: p.note.start + p.note.quote.length } } : {}) };
        if (host.startSession) await host.startSession("select");
        else await personComments(surface, host, "select");
        if (!surface.session) throw new ActionRefused("the comment didn't open: the note couldn't be read for commenting");
        host.redraw();
        // restored: what was put aside on this note came back into it (a handover's restore checks it did).
        return { writing: action, passage: p.target, restored: !!surface.session.composer?.restored };
      }
      const named = /^ext\.([a-z][a-z0-9-]{0,31})\.([a-z][a-z0-9-]{0,31})$/.exec(action);
      const choice = passageActions().find(x => x.action.name === action);
      if (!named || !choice) throw new ActionRefused(`no passage action ${action}: it's comment, ask, explain${passageActions().length ? `, or ${passageActions().map(x => x.action.name).join(", ")}` : " (no extension here acts on a passage)"}`);
      // What it declares and the person didn't say is asked for first, in the power bar (PIE-784); then it runs.
      // Run, then what follows a run here (asked for its arguments first, the run comes when they're answered).
      const run = async (args: Record<string, string>) => {
        const r = await runExtensionAction(host.ctx, choice.action, choice.extension.id, { passage: p.target, ...(m.resource?.from ? { blockId: m.resource.from } : {}), ...(Object.keys(args).length ? { args } : {}) }, actor);
        // Copy with a citation: the person's clipboard; an agent gets the text back, the person's clipboard untouched.
        if (r.copy !== undefined && actor.kind === "user") host.ctx.copy?.(r.copy);
        if (r.written.length) await surface.loadComments(host);
        if (actor.kind === "user") surface.selection = null;
        surface.noteAgent(actor, `${choice.action.label.toLowerCase()} on "${p.note.quote}"`);
        host.redraw();
        return { said: r.said, written: r.written, ...(r.copy !== undefined ? { copy: r.copy, clipboard: actor.kind === "user" } : {}), passage: r.passage ?? p.target, ...(r.undo ? { undo: r.undo } : {}) };
      };
      // What it declares and the person didn't say is asked for first, in the power bar (PIE-784).
      return askingFirst(host.ctx as never, choice.extension, choice.action, p.target.subject.startsWith("resource:") ? m.resource?.from : p.target.subject, color ? { color } : {}, actor, run);
    },
  }),
  "passage.choices": def({
    summary: "list what can be done with a passage here: comment, ask and explain (when an agent answers in threads) and each extension's passage action, with its key after a",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { surface }) {
      return { choices: surface.passageChoices(), agents: threadAgents().map(a => a.name) };
    },
  }),
  "margin": def({
    summary: `the margin's cards (ADR 0004 contract 6): trim, ${MARGIN_MODE_WORDS.trim.does}; full, ${MARGIN_MODE_WORDS.full.does}; off, ${MARGIN_MODE_WORDS.off.does} (the highlights stay on the words). The byline's count says which: ${MARGIN_MODES.map(x => `"${MARGIN_MODE_WORDS[x].chip}"`).join(", ")}. Reading state agents may change for the person, kept with the tile (PIE-873) and taken by a reader opened from it`,
    keys: [{ keys: "M", does: "cycles trim, full, off (as marks)" }, { keys: "click", does: "the byline's comment count" }],
    touches: "shape", replay: "safe",
    args: { mode: { type: "string", optional: true, about: "trim, full or off; left out, the next one" } },
    examples: [
      { act: "margin", does: "cycles the margin's cards to the next of trim, full and off" },
      { act: "margin mode=full", does: "shows each margin card whole, with its replies" },
    ],
    run({ mode }, { surface, host }, actor) {
      const next = mode === undefined ? nextMargin(surface.marginMode) : (MARGIN_MODES as readonly string[]).includes(mode) ? mode as MarginMode : null;
      if (!next) throw new ActionRefused("mode is trim, full or off");
      surface.setMargin(next);
      surface.noteAgent(actor, `comments: ${MARGIN_MODE_WORDS[next].chip}`);
      // Kept with the tile (PIE-873): a handover, a restart and the next note read the same way.
      host.keptChanged?.();
      host.ctx.flash(`comments: ${MARGIN_MODE_WORDS[next].does} · M for ${MARGIN_MODE_WORDS[nextMargin(next)].chip}`);
      host.redraw();
      return { margin: next };
    },
  }),
  "comment.escape": def({
    summary: "close the comment, putting unsent text aside on the second press", keys: modeActionKeys(ATTACHED_KEYS, "comment.escape"),
    touches: "draft", draft: "leave", replay: "ask", person: "the person's comment keys", args: {},
    run: (_, { surface, host }) => surface.commentEscape(host),
  }),
  "comment.close": def({
    summary: "close the comment session; unsent text needs discard=true (and is put aside as unsent, with a copy on disk)", keys: modeActionKeys(ATTACHED_KEYS, "comment.escape"),
    touches: "draft", draft: "leave", replay: "ask",
    args: { discard: { type: "boolean", optional: true, about: "close even with unsent text" } },
    examples: [
      { act: "comment.close", does: "closes the comment session when no text is unsent" },
      { act: "comment.close discard=true", does: "closes it even with unsent text, putting that aside as unsent" },
    ],
    run({ discard }, { surface, host }) {
      const s = surface.session;
      if (!s) return { closed: false };
      if (s.dirty && !discard) throw new ActionRefused("the comment isn't sent; comment.send sends it, discard=true closes it anyway (put aside as unsent first, as esc twice does)");
      const r = s.writing?.close(true);
      surface.closeSession(); host.redraw();
      return { closed: true, keptAt: r?.keptAt };
    },
  }),
  "placement.menu": def({
    summary: "choose where the attachment sits; the current placement is marked",
    keys: "click the placement chip", touches: "tile", person: "the placement belongs to the person", replay: "ask",
    args: { target: { type: "string", about: "comment, sources, list-preview or edit-preview" } },
    examples: [{ act: "placement.menu target=sources", does: "opens the Sources placement menu" }],
    run({ target }, { surface, host }) {
      if (target !== "comment" && target !== "sources" && target !== "list-preview" && target !== "edit-preview") throw new ActionRefused("target is comment, sources, list-preview or edit-preview");
      return surface.openPlacementMenu(target, host);
    },
  }),
  "placement.step": def({
    summary: "move through the placement menu", keys: [{ keys: "← ↑ ↓ → j k tab", does: "in the placement menu" }],
    touches: "tile", person: "the placement belongs to the person", replay: "ask",
    args: { by: { type: "number", about: "rows to move" } },
    examples: [{ act: "placement.step by=1", does: "selects the next placement" }],
    run: ({ by }, { surface, host }) => surface.stepPlacement(by, host),
  }),
  "placement.choose": def({
    summary: "choose a placement from the open menu", keys: "Enter or click a placement",
    touches: "tile", person: "the placement belongs to the person", replay: "ask",
    args: { place: { type: "string", optional: true, about: "placement; left out, the selected row" }, direction: { type: "string", optional: true, about: "right or down for a split" } },
    examples: [{ act: "placement.choose place=split direction=right", does: "places the attachment beside the note" }],
    run: ({ place, direction }, { surface, host }) => surface.choosePlacement(place, host, direction),
  }),
  "placement.close": def({
    summary: "close the placement menu", keys: "Esc or click outside the placement menu",
    touches: "tile", person: "the placement belongs to the person", replay: "ask", args: {},
    run: (_, { surface, host }) => surface.closePlacement(host),
  }),
  "attachment.split": def({
    summary: "size an attached surface split, or choose beside versus below", keys: [{ keys: "drag", does: "the split divider" }, { via: "placement menu beside/below" }],
    touches: "tile", person: "the split belongs to the person", replay: "ask",
    args: { target: { type: "string", about: "comment, sources, list-preview or edit-preview" }, direction: { type: "string", optional: true, about: "right or down" }, share: { type: "number", optional: true, about: "attachment share of the reader, .15 to .85" } },
    examples: [{ act: "attachment.split target=sources direction=down share=0.4", does: "puts the sources split below the note with forty percent of its height" }],
    run({ target, direction, share }, { surface, host }) {
      if (target !== "comment" && target !== "sources" && target !== "list-preview" && target !== "edit-preview") throw new ActionRefused("target is comment, sources, list-preview or edit-preview");
      return surface.splitAttachment(target, direction, share, host);
    },
  }),
  "sources.grip": def({
    summary: "move or size sources with the comment box's grip keys", keys: modeActionKeys(ATTACHED_KEYS, "sources.grip"),
    touches: "tile", person: "the panel belongs to the person", replay: "ask", args: {},
    run: (_, { surface, host }) => surface.gripSources(host),
  }),
  "sources.move": def({
    summary: "move or size the floating Sources panel inside its reader", keys: "drag its header or corner; ctrl+g then arrows or shift+arrows",
    touches: "tile", person: "the panel belongs to the person", replay: "ask", args: FLOAT_MOVE_ARGS,
    examples: [{ act: "sources.move dx=2 dy=-1", does: "moves floating sources right and up" }],
    run: (args, { surface, host }) => surface.moveSources(args, host),
  }),
  "edit.preview.place": def({
    summary: "place the edit preview below, beside, floating, popup or in a tile; kept for next time",
    keys: [{ keys: "click", does: "the preview header's placement chip" }, { keys: "← ↑ ↓ → ⏎", does: "in its menu" }],
    touches: "tile", person: "the placement belongs to the person", replay: "ask",
    args: { place: { type: "string", optional: true, about: "inline (below), split, floating, popup or tile" }, side: { type: "string", optional: true, about: "left, right, up or down for a tile" } },
    examples: [{ act: "edit.preview.place place=split", does: "places the live preview beside or below the draft" }],
    run({ place, side }, { surface, host }) {
      if (side !== undefined && !["left", "right", "up", "down"].includes(side)) throw new ActionRefused("side is left, right, up or down");
      return surface.placeEditPreview(place, host, side as AttachedSide | undefined);
    },
  }),
  "edit.preview.move": def({
    summary: "move or size the floating edit preview inside its reader", keys: "drag its header or corner",
    touches: "tile", person: "the preview belongs to the person", replay: "ask", args: FLOAT_MOVE_ARGS,
    examples: [{ act: "edit.preview.move dx=2 dy=-1", does: "moves the floating edit preview right and up" }],
    run(args, { surface, host }) {
      const p = surface.editPreview;
      if (!p.frame || p.place !== "floating") throw new ActionRefused("edit.preview.place place=floating floats it first");
      p.float = args.reset ? null : moveFloat(p.float ?? p.frame, args, p.room);
      host.redraw(); return p.float;
    },
  }),
  "sources.place": def({
    summary: "place sources inline, floating, split, popup or in its own tile; kept for next time",
    keys: modeActionKeys(ATTACHED_KEYS, "sources.place"),
    touches: "tile", person: "the placement belongs to the person", replay: "ask",
    args: { place: { type: "string", optional: true, about: "inline, floating, split, popup, tile; left out, cycle" }, side: { type: "string", optional: true, about: "left, right, up or down for a tile" } },
    examples: [{ act: "sources.place place=tile side=right", does: "puts Sources in a tile beside the note" }],
    run: ({ place, side }, { surface, host }) => surface.placeSources(place, side, host),
  }),
  "comment.place": def({
    summary: "where the comment, question or reply being written sits (PIE-770): inline (a box under its passage, in the note, which still reads and scrolls around it), floating (a box over the note beside the passage), split (the reader shared: the note beside the composer, or over it when narrow), popup (a box in the middle, the passage quoted) or tile (PIE-846: a tile of its own in the note's place, beside it on side= left, right, up or down, the tiles round them never moving; sized by its border; closing it gives the note its room back; the thread list (m) goes there too). Left out, the next one. This composer only: composer.place sets where new ones open",
    keys: modeActionKeys(ATTACHED_KEYS, "comment.place"),
    touches: "draft", draft: "type", replay: "ask",
    args: {
      place: { type: "string", optional: true, about: `${ATTACHED_PLACES.join(", ")}; left out, the next one (with side=, tile)` },
      side: { type: "string", optional: true, about: "left, right, up or down: which side of its note the comment's tile is on (PIE-846); kept for the next" },
    },
    examples: [
      { act: "comment.place place=split", does: "shares the reader: the note beside the comment being written" },
      { act: "comment.place place=tile side=right", does: "gives the comment a tile of its own to the right of the note" },
    ],
    async run({ place, side }, { surface, host }) {
      const s = surface.session;
      if (!s) throw new ActionRefused("no comment is being written here; C on selected words (or passage.act action=comment) opens one");
      // The thread list (m) goes into its tile beside the note and back over it (PIE-846); a comment anywhere.
      if (s.mode !== "compose" && place !== undefined && place !== "tile" && s.place !== "tile") throw new ActionRefused("the thread list is drawn over the note, or in its own tile beside it: place=tile");
      if (side !== undefined && !["left", "right", "up", "down"].includes(side)) throw new ActionRefused(`side is left, right, up or down, not ${JSON.stringify(side)}`);
      const want = place === undefined ? (side !== undefined ? "tile" : nextPlace(s.place, !!host.composerTile)) : attachedPlaceOf(place);
      if (!want) throw new ActionRefused(`place is ${ATTACHED_PLACES.join(", ")}, not ${JSON.stringify(place)}`);
      if (want === "tile" && !host.composerTile) throw new ActionRefused("this reader has no tiles round it to put the comment in · split is the nearest (comment.place place=split)");
      if (want === "split" && side) surface.splitAttachment("comment", side, undefined, host);
      await surface.placeAttachment("comment", want, host, side as AttachedSide | undefined);
      if (surface.sourcesMode) surface.focusSources(host, false);
      surface.revealComposerNext();
      host.redraw();
      return { place: want, ...(side !== undefined ? { side } : {}) };
    },
  }),
  "comment.grip": def({
    summary: "move and size the comment being written by keys (PIE-785): it floats (if it was elsewhere), then ← → ↑ ↓ or h j k l move it, shift+arrows or H J K L size it, 0 puts it back in its usual place, ⏎ or esc is done. Each step is comment.move. For this sitting only: opened again, it's in its usual place",
    keys: modeActionKeys(ATTACHED_KEYS, "comment.grip"),
    touches: "draft", draft: "type", replay: "ask",
    args: {},
    run(_, { surface, host }) {
      surface.grip(host);
      return { moving: true };
    },
  }),
  "comment.move": def({
    summary: "move or size the floating comment being written (PIE-785): dx dy step it (columns, rows), col row put its corner there, dcols drows or cols rows size it (the reader's cells); reset=true puts it back in its usual place beside the passage. Moving it never changes the passage it's on. For this sitting only: never kept, so a comment opened again (or read later) is in its usual place",
    keys: "drag its top edge (≡ move), drag its ◢ corner or edges; ctrl+g then arrows (shift: size)",
    touches: "draft", draft: "type", replay: "ask",
    args: FLOAT_MOVE_ARGS,
    examples: [
      { act: "comment.move dx=4 dy=-2", does: "moves the floating comment four columns right and two rows up" },
      { act: "comment.move cols=60 rows=12", does: "sizes the floating comment to 60 columns by 12 rows" },
      { act: "comment.move reset=true", does: "puts the floating comment back in its usual place and size" },
    ],
    run(args, { surface, host }) {
      return { float: surface.moveComposer(args, host) };
    },
  }),
  "comment.leaving": def({
    summary: "answer \"about to leave an unsent comment\" (PIE-785), asked when the person follows a link, a comment mark, back or forward while their comment is unsent: save keeps it as unsent where it was written (opening it again brings it back) and goes on; keep goes back to writing; discard lets it go (a copy stays on disk) and goes on. The person's choice: an agent's action never asks it",
    keys: [{ keys: "⏎ click", does: "the power bar's rows" }, { keys: "esc", does: "keeps writing", says: "keep writing the comment" }],
    touches: "draft", draft: "leave", replay: "ask", person: "leaving the person's unsent comment is their choice",
    args: { choice: { type: "string", about: "save, keep or discard" } },
    examples: [
      { act: "comment.leaving choice=save", does: "keeps the unsent comment where it was written and goes on" },
      { act: "comment.leaving choice=keep", does: "goes back to writing the comment instead of leaving" },
      { act: "comment.leaving choice=discard", does: "lets the unsent comment go, a copy staying on disk, and goes on" },
    ],
    run({ choice }, { surface, host }) {
      if (choice !== "save" && choice !== "keep" && choice !== "discard") throw new ActionRefused(`choice is save, keep or discard, not ${JSON.stringify(choice)}`);
      return surface.answerLeave(choice, host);
    },
  }),
  "threads": def({
    summary: "show the note's comment threads (the person's opens on the comment mark the [ ] position is on); in the list, j k move and PgUp PgDn and the wheel scroll it", keys: "m; j k PgUp PgDn wheel in the list",
    touches: "tile", replay: "safe", way: "the thread list would cover what they're reading · an agent lists threads in another reader (tile=)",
    menu: noteRow("comments", "m", { busy: true }),
    args: {},
    async run(_, { surface, host, standing }, actor) {
      // The person's opens as it was asked for: on a comment mark's thread, or with a Reply control's reply started.
      const s = standing && !surface.session && !surface.draft ? await personComments(surface, host, "threads") : await surface.ensureSession(host, "threads", actor);
      host.redraw();
      return { threads: s.threads.map(t => ({ id: t.id, open: t.open, author: t.author, quote: t.quote, body: t.body, replies: t.replies.length })) };
    },
  }),
  "thread.toggle": def({
    summary: "open a comment card (its comment, replies and Select, Reply, Resolve controls), or fold it to its gutter mark; expand=true or false sets it. Agents may change this reading state for the person without moving focus or selection", keys: "enter or a click on a comment mark",
    touches: "shape", replay: "safe",
    args: {
      thread: { type: "string", about: "the thread's id (or its first 6+ characters)" },
      expand: { type: "boolean", optional: true, about: "true expands, false collapses; left out, it toggles" },
    },
    examples: [
      { act: "thread.toggle thread=5b2e8d", does: "opens that comment card, or folds it to its gutter mark if open" },
      { act: "thread.toggle thread=5b2e8d expand=false", does: "folds that comment card to its gutter mark" },
    ],
    async run({ thread, expand }, { surface, host }, actor) {
      await surface.whole();
      const id = surface.threadId(thread);
      surface.setExpanded(id, expand ?? !surface.threadShown(id));
      if (actor.kind === "user") { surface.readThread(id, host); surface.revealCard(id); }
      surface.noteAgent(actor, `${surface.threadShown(id) ? "opened" : "folded"} a comment`);
      host.redraw();
      return { thread: id, expanded: surface.threadShown(id) };
    },
  }),
  "reply": def({
    summary: "reply to a comment thread and send it. Left out body=, the person's reply opens on the thread to be written (a reply put aside there comes back); an agent's is sent at once", keys: [{ keys: "m", does: "the thread list" }, { keys: "j k", does: "pick a thread" }, { keys: "r", does: "reply, then typing" }, { keys: "ctrl+s", does: "save the reply" }, { keys: "click", does: "[Reply] on an expanded thread" }],
    touches: "draft", draft: "type", replay: "ask",
    args: { thread: { type: "string", about: "the thread's id (or its first 6+ characters)" }, body: { type: "string", optional: true, about: "the reply's text, sent at once; left out, the person writes it" } },
    examples: [
      { act: 'reply thread=5b2e8d body="Yes, the front bed too"', does: "sends that reply on the comment thread at once" },
      { act: "reply thread=5b2e8d", does: "opens the person's reply on that thread, ready to write" },
    ],
    async run({ thread, body }, on, actor) {
      if (body === undefined && actor.kind === "agent") throw new ActionRefused("say body=: an agent's reply is sent at once");
      const s = await on.surface.ensureSession(on.host, "threads");
      const why = s.replyTo(findThread(s, thread), actor);
      if (why) throw new ActionRefused(why);
      // Written by hand: as the Reply control opens it, back to reading once it's sent.
      if (body === undefined) { s.fromReader = true; on.host.redraw(); return { replying: s.target?.kind === "reply" ? s.target.thread.id : thread, restored: !!s.composer?.restored }; }
      s.writing!.replace(body, actor);
      return sendComment(on.surface, on.host, actor);
    },
  }),
  "comment.edit": def({
    summary: "edit a posted comment, or one of its replies (reply=), in the same editor it was written in (PIE-763). Left out body=, the person's editor opens on its words (ctrl+s saves, esc leaves it as it was, a click away saves it as an edit does); body= saves new words at once, as an agent's always does. Checked against the revision it was read at: an edit made meanwhile is refused (ctrl+r loads it), never overwritten. Attributed to whoever edits it; it shows as edited, its earlier words kept in its revisions",
    keys: [{ keys: "e", does: "in the thread list (m)" }, { keys: "click", does: "[Edit] on an expanded thread, or beside one of its replies" }],
    touches: "draft", draft: "type", replay: "ask",
    args: {
      thread: { type: "string", about: "the thread's id (or its first 6+ characters)" },
      reply: { type: "string", optional: true, about: "one of its replies to edit instead (its id, or its first 6+ characters); left out, the thread's own comment" },
      body: { type: "string", optional: true, about: "the new words, saved at once; left out, the person's editor opens on the words as they are" },
      observed: { type: "string", optional: true, about: "with body=: the words as you read them (threads lists them); an agent's edit needs it, so an edit made meanwhile is refused, never overwritten" },
    },
    examples: [
      { act: 'comment.edit thread=5b2e8d body="Which beds get mulch?" observed="Which beds?"', does: "saves new words for the comment, refused if it changed since they were read" },
      { act: "comment.edit thread=5b2e8d", does: "opens the person's editor on that comment's words" },
    ],
    async run({ thread, reply, body, observed }, on, actor) {
      if (body === undefined && actor.kind === "agent") throw new ActionRefused("say body=: an agent's edit is saved at once (the words it read are in threads)");
      if (body !== undefined && observed === undefined && actor.kind === "agent") throw new ActionRefused("say observed=: the comment's words as you read them (threads lists them), so an edit made since isn't overwritten");
      const s = await on.surface.ensureSession(on.host, "threads");
      const i = findThread(s, thread);
      // Checked before anything opens: the words read are still its words.
      if (observed !== undefined) {
        const th = s.threads[i]!, now = reply === undefined ? th : th.replies.find(x => x.id === reply || (reply.length >= 6 && x.id.startsWith(reply)));
        if (now && now.body.trim() !== observed.trim()) throw new ActionRefused(`it changed since you read it; its words now: ${JSON.stringify(now.body)} · read them again and edit those`);
      }
      const why = s.editMark(i, reply, actor);
      if (why) throw new ActionRefused(why);
      const t = s.target as Extract<NonNullable<typeof s.target>, { kind: "edit" }>;
      if (body === undefined) { on.host.redraw(); return { editing: t.mark.id, revision: t.mark.revision, words: t.mark.body, restored: !!s.composer?.restored }; }
      s.writing!.replace(body, actor);
      return sendComment(on.surface, on.host, actor);
    },
  }),
  "resolve": def({
    summary: "resolve a comment thread that's a ticket (a request done), or reopen it with open=true. A thread that only needed reading is seen (thread.seen), not resolved. It opens the thread list in the reader: an agent's is refused on the reader the person has", keys: [{ keys: "m then s", does: "marks one seen" }],
    touches: "tile", replay: "ask", way: "the thread list would cover what they're reading · an agent resolves it in another reader (tile=)",
    args: { thread: { type: "string", about: "the thread's id (or its first 6+ characters)" }, open: { type: "boolean", optional: true, about: "reopen instead of resolving" } },
    examples: [
      { act: "resolve thread=5b2e8d", does: "marks that comment thread resolved, a request done" },
      { act: "resolve thread=5b2e8d open=true", does: "reopens that resolved comment thread" },
    ],
    async run({ thread, open }, on, actor) {
      return attention(on, actor, thread, open ? "open" : "resolved", open ? "reopened a comment" : "resolved a comment");
    },
  }),
  "thread.seen": def({
    summary: "mark a comment thread seen (PIE-791): it leaves the margin for the earlier shelf, and a new reply brings it back; back=true brings it back now. It opens the thread list in the reader",
    keys: [{ keys: "s", does: "in the thread list (m)" }, { keys: "click", does: "[Seen] on an expanded thread" }],
    touches: "tile", replay: "ask", way: "the thread list would cover what they're reading · an agent marks it in another reader (tile=)",
    args: { thread: { type: "string", about: "the thread's id (or its first 6+ characters)" }, back: { type: "boolean", optional: true, about: "bring an earlier thread back instead" } },
    examples: [
      { act: "thread.seen thread=5b2e8d", does: "marks that thread seen, moving it off the margin to the earlier shelf" },
      { act: "thread.seen thread=5b2e8d back=true", does: "brings that earlier thread back into the margin" },
    ],
    async run({ thread, back }, on, actor) {
      const s = await on.surface.ensureSession(on.host, "threads");
      const t = s.threads[findThread(s, thread)]!;
      const to = (back ?? !t.open) ? "open" : "seen";
      return attention(on, actor, thread, to, to === "seen" ? "marked a comment seen" : "brought a comment back");
    },
  }),
  "thread.keep": def({
    summary: "keep a comment thread (PIE-791): it stays in the margin whatever else is put away, and is in the outline's kept marks; again (or keep=false) unkeeps it. It opens the thread list in the reader",
    keys: [{ keys: "p", does: "in the thread list (m)" }, { keys: "click", does: "[Keep] on an expanded thread" }],
    touches: "tile", replay: "ask", way: "the thread list would cover what they're reading · an agent keeps it in another reader (tile=)",
    args: { thread: { type: "string", about: "the thread's id (or its first 6+ characters)" }, keep: { type: "boolean", optional: true, about: "true keeps, false unkeeps; left out, it toggles" } },
    examples: [
      { act: "thread.keep thread=5b2e8d", does: "keeps that thread in the margin, or unkeeps it if kept" },
      { act: "thread.keep thread=5b2e8d keep=false", does: "unkeeps that thread so it can be put away" },
    ],
    async run({ thread, keep }, on, actor) {
      const s = await on.surface.ensureSession(on.host, "threads");
      const t = s.threads[findThread(s, thread)]!;
      const to = (keep ?? t.lifecycle !== "kept") ? "kept" : "open";
      return attention(on, actor, thread, to, to === "kept" ? "kept a comment" : "unkept a comment");
    },
  }),
  "thread.tldr": def({
    summary: "a comment thread's TL;DR (PIE-791): @margin writes a short summary as a reply with [kind::tldr], which becomes the thread's face, its discussion folded behind it. body= writes it instead (yours, or an edit of @margin's). With no model set up for @margin none is written, and it says how to set one up (PIE-860). remove=true takes it away: the discussion is the face again",
    keys: [{ keys: "t", does: "in the thread list (m)" }, { keys: "T", does: "takes it away" }, { keys: "click", does: "[TL;DR] on an expanded thread, [TL;DR again], [No TL;DR]" }],
    touches: "tile", replay: "ask", way: "the thread list would cover what they're reading · an agent asks in another reader (tile=)",
    args: { thread: { type: "string", about: "the thread's id (or its first 6+ characters)" }, body: { type: "string", optional: true, about: "the TL;DR itself; left out, @margin writes it" }, remove: { type: "boolean", optional: true, about: "take its TL;DR away" } },
    examples: [
      { act: "thread.tldr thread=5b2e8d", does: "asks @margin to write a short TL;DR as that thread's face" },
      { act: 'thread.tldr thread=5b2e8d body="Mulch the front bed in March"', does: "sets that thread's TL;DR to those words" },
      { act: "thread.tldr thread=5b2e8d remove=true", does: "takes the TL;DR away so the discussion is the face again" },
    ],
    async run({ thread, body, remove }, { surface, host }, actor) {
      // Taken away from an expanded thread or the list: the thread changes, the person's view doesn't (no list opens).
      if (remove) {
        await surface.whole();
        const id = surface.threadId(thread), c = surface.comments?.find(x => x.id === id);
        if (!c?.tldr) throw new ActionRefused("this thread has no TL;DR to take away");
        await host.ctx.board.tldr(id, actor, undefined, true);
        await surface.loadComments(host);
        if (surface.session?.mode === "threads") surface.session.threads = surface.comments ?? surface.session.threads;
        asActor(host.ctx, actor).flash("took the TL;DR away");
        surface.noteAgent(actor, "took a comment's TL;DR away");
        host.redraw();
        return { removed: true };
      }
      const s = await surface.ensureSession(host, "threads");
      const i = findThread(s, thread);
      s.sel = i;
      const env = surface.env(host, actor);
      if (body) {
        await env.board.tldr(s.threads[i]!.id, actor, body);
        s.threads = await env.reloadComments();
        surface.noteAgent(actor, "wrote a comment's TL;DR");
        host.redraw();
        return { tldr: body };
      }
      const asked = await s.askTldr(env);
      if (!asked) throw new ActionRefused(s.error ?? "no agent could be asked for a TL;DR");
      surface.noteAgent(actor, "asked for a comment's TL;DR");
      host.redraw();
      return { asked };
    },
  }),
  "note.move": def({
    summary: "move a note (PIE-943; PIE-883's note.place is this with to=): the one shown, or id=, under a note (to= inbox, root, or a note's id, ((ref)), [[page]], Work ID; position= its place among the children, from 1, default first), beside a sibling (before= or after=) or one step in its list (step= up, down, in under the note above, out after its parent). The service's move, the note checked at revision= when given (one changed since is refused), recorded as whoever asks and put back by ctrl+z (note.move.undo). The person's, left out, is asked in the power bar (\"Move to…\"): the note's parents and the notes changed lately first, the Inbox, then any note by its words. An agent's goes by outline_move's rules (the outliner's moveBlock)",
    keys: modeActionKeys(ATTACHED_KEYS, "note.move"),
    touches: "nothing", replay: "ask",
    menu: { label: "move to…", group: "note", key: "Z", now: (_h, t) => (t.kind === "river.column" ? { hide: true } : null) },
    says: r => String((r as { said?: string }).said ?? "moved a note"),
    args: {
      id: { type: "string", optional: true, about: "the note to move (default: the one shown)" },
      to: { type: "string", optional: true, about: "the note to put it under: inbox, root (the top level), or an id, ((ref)), [[page]] or Work ID" },
      before: { type: "string", optional: true, about: "a sibling to go just above" },
      after: { type: "string", optional: true, about: "a sibling to go just below" },
      position: { type: "number", optional: true, about: "with to=: its place among the children, from 1 (default: first)" },
      step: { type: "string", optional: true, about: "up or down one place among its siblings, in (last under the sibling above) or out (right after its parent)" },
      revision: { type: "number", optional: true, about: "the note's revision as you read it; a note changed since is refused" },
    },
    examples: [
      { act: "note.move tile=reader to=inbox", does: "moves the note the reader shows under the inbox, first among its children" },
      { act: "note.move id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 after=3e8b2c71-9d40-4f6a-b1e5-2a7c9f0d4b18", does: "moves that note to just below the other, its sibling" },
    ],
    async run(args, { surface, host }, actor) {
      const id = args.id ?? surface.requireNote().id;
      const revision = args.revision ?? (surface.msg?.id === id ? surface.msg.revision : undefined);
      const asked = [args.to, args.before, args.after, args.step].some(x => x !== undefined);
      const run = async (a: MoveArgs) => {
        const done = await moveNote(host.ctx.board, id, intentOf(a), actor, { revision });
        if (surface.replyLinks) await surface.openReplyLinks(host, { kind: "user" }, true);
        // The reader showing it reads its place again; the person's is told where it went.
        if (surface.msg?.id === id) {
          const fresh = await host.ctx.board.get(id).catch(() => null);
          if (fresh) surface.refresh(fresh);
          await surface.rereadPlace(host);
        }
        asActor(host.ctx, actor).flash(done.said);
        surface.noteAgent(actor, done.said);
        return done;
      };
      if (asked) return run(args);
      if (actor.kind === "agent") throw new ActionRefused("say where: to=<inbox, root, or a note's id, ((ref)), [[page]], Work ID>, before=, after= or step=up|down|in|out");
      return askInBar(host.ctx as never, "Move the note", [moveQuestion(id)], {}, actor, answers => run({ ...args, to: answers.to! }));
    },
  }),
  "note.route": def({
    summary: "route a note by the outline's routing rules (PIE-1010): the one shown, or id=. The first rule note ([type::route] [query::…] [route-to::((id))], listed in the Routing view) whose query holds for it moves it there, by the service's one move, as ext:route with you recorded as who asked, in one revision; ctrl+z puts it back (note.move.undo). dry=true says what would move where and why (which rule) and moves nothing; a note no rule holds for is said so, and a rule that can't be used is named. A note being written in a door is never moved under the person: it routes when the draft closes",
    keys: [{ keys: "alt+z", does: "in a reader" }, { keys: "alt+Z", does: "says what would move, moving nothing" }, { via: "the tile menu's \"route by rules\"" }],
    touches: "nothing", replay: "ask",
    menu: { label: "route by rules", group: "note", key: "alt+z", now: (_h, t) => (t.kind === "river.column" ? { hide: true } : null) },
    says: r => String((r as { said?: string }).said ?? "routed a note"),
    args: {
      id: { type: "string", optional: true, about: "the note to route (default: the one shown)" },
      dry: { type: "boolean", optional: true, about: "say what would move where and why, moving nothing" },
    },
    examples: [
      { act: "note.route dry=true", does: "says where the note shown would move and which rule, moving nothing" },
      { act: "note.route", does: "moves the note shown by the first routing rule that holds for it" },
    ],
    async run({ id, dry }, { surface, host }, actor) {
      const target = id ?? surface.requireNote().id;
      const done = await routeNote(host.ctx.board, target, actor, { dryRun: dry === true });
      if (done.outcome === "moved") {
        if (surface.replyLinks) await surface.openReplyLinks(host, { kind: "user" }, true);
        if (surface.msg?.id === target) {
          const fresh = await host.ctx.board.get(target).catch(() => null);
          if (fresh) surface.refresh(fresh);
          await surface.rereadPlace(host);
        }
      }
      asActor(host.ctx, actor).flash(done.said);
      surface.noteAgent(actor, done.said);
      host.redraw();
      return done;
    },
  }),
  "note.move.undo": def({
    summary: "put the note shown back where the last move made here (by you) took it from",
    keys: modeActionKeys(ATTACHED_KEYS, "note.move.undo"), touches: "nothing", replay: "ask", args: { id: { type: "string", optional: true, about: "the moved note; default the one shown" } },
    examples: [
      { act: "note.move.undo", does: "puts the note shown back where your last move took it from" },
      { act: "note.move.undo id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "puts that note back where your last move took it from" },
    ],
    async run({ id }, { surface, host }, actor) {
      const m = surface.requireNote();
      const target = id ?? m.id;
      const done = await undoMove(host.ctx.board, actor, target);
      const fresh = await host.ctx.board.get(m.id).catch(() => null);
      if (fresh) surface.refresh(fresh);
      if (surface.replyLinks) await surface.openReplyLinks(host, { kind: "user" }, true);
      await surface.rereadPlace(host);
      asActor(host.ctx, actor).flash(done.said);
      return done;
    },
  }),
  "quote": def({
    summary: "quote marks into a new block (the margin's quote-tweet): a highlight, a comment or a reply, or several, each transcluded (!((mark))) under one [from::((mark))] line so it traces back to where it was said; each mark's card then says quoted in. where= inbox (the default), note (under this note) or a block (its id or ((ref))); the person's, left out, is asked in the power bar: under this note (first: a quote-reply sits with what it answers), the Inbox, or any note by its words. The person's quote then opens where their new notes open (note.opens: a float beside the reader, by default), lit as just arrived, in their edit at the end of the quote (PIE-1184); an agent's opens nothing. text= the new block's own words above the quotes (its title). The marks stay where they are. One write: ctrl+z (ext.undo) takes it back. Recorded as whoever asks",
    keys: "q in the thread list (m) on the thread, or on the threads picked with space; a click on an expanded thread's [Quote] or a reply's [Quote]",
    touches: "nothing", replay: "ask",
    args: {
      threads: { type: "string", optional: true, about: "the marks: ids (or their first 6+ characters) of threads (a highlight or comment) or replies on this note, comma-separated; left out, the thread list's picked threads, else its current one" },
      where: { type: "string", optional: true, about: "inbox (the top of the Inbox), note (under this note) or a block id or ((ref)) to put it under; an agent's default is inbox" },
      text: { type: "string", optional: true, about: "the new block's own words, above the quotes (its first line is its title); left out, Quoting “…”" },
    },
    examples: [
      { act: "quote threads=5b2e8d", does: "quotes that mark into a new block at the top of the Inbox" },
      { act: 'quote threads=5b2e8d,9c41af where=note text="Mulch notes"', does: "quotes both marks into a block titled Mulch notes under this note" },
    ],
    async run({ threads, where, text }, { surface, host, standing }, actor) {
      surface.requireNote();
      await surface.loadComments(host);
      // The thread list's picks are the person's: only their own quote takes (and clears) them.
      const s = actor.kind === "user" && surface.session?.mode === "threads" ? surface.session : null;
      const named = threads ?? (s ? (s.picked.size ? [...s.picked].join(",") : s.threads[s.sel]?.id) : undefined);
      if (!named) throw new ActionRefused("say which marks: threads=<id>[,<id>…] (peek lists them under comments.threads); in the thread list, q quotes the current thread or the ones picked with space");
      const ids = surface.markIds(named);
      // The person's quote lands where they are (PIE-1184): opened in their edit where their new notes open.
      const run = (answers: Record<string, string>) => surface.quoteMarks(ids, answers.where ?? "inbox", host, actor, text, standing && actor.kind === "user").then(r => { s?.picked.clear(); return r; });
      if (where !== undefined || actor.kind === "agent") return run({ where: where ?? "inbox" });
      // Under this note first: a quote-reply sits with what it answers.
      return askInBar(host.ctx as never, ids.length === 1 ? "Quote a mark" : `Quote ${ids.length} marks`, [{
        name: "where", type: "note", label: "where it goes", description: "The new block transcludes each mark and links back to it, and opens beside you to write in. Under this note (a child of it), the Inbox, or type to find any note to put it under.",
        choices: ["note", "inbox"], says: { note: "under this note", inbox: "in the Inbox" },
      }], {}, actor, run);
    },
  }),
  "thread.pick": def({
    summary: "pick a thread in the thread list for a quote of several (q then quotes the picked ones); again unpicks it. The person's thread list: an agent names its marks with quote threads=",
    keys: "space in the thread list (m)",
    touches: "tile", replay: "safe", person: "the thread list's picks are the person's; an agent names its marks with quote threads=",
    args: { thread: { type: "string", optional: true, about: "the thread's id (or its first 6+ characters); left out, the current one" } },
    examples: [
      { act: "thread.pick thread=5b2e8d", does: "picks that thread in the list for a quote of several, or unpicks it" },
      { act: "thread.pick", does: "picks the thread the list is on, or unpicks it" },
    ],
    run({ thread }, { surface, host }) {
      const s = surface.session;
      if (!s || s.mode !== "threads") throw new ActionRefused("the thread list isn't open · m opens it");
      const id = thread !== undefined ? s.threads[findThread(s, thread)]!.id : s.threads[s.sel]?.id;
      if (!id) throw new ActionRefused("no thread here to pick");
      if (s.picked.has(id)) s.picked.delete(id); else s.picked.add(id);
      host.redraw();
      return { picked: [...s.picked] };
    },
  }),
  "props": def({
    summary: "open the property panel: every property token (repeats and block/line/inline scope kept), with the summary line's keys", keys: [{ keys: "i", does: "open the property panel" }, { keys: "I", does: "full", says: "open the property panel filling the reader" }],
    touches: "nothing", replay: "safe",
    menu: noteRow("properties", "i", { busy: true }),
    args: { full: { type: "boolean", optional: true, about: "fill the reader instead of sitting above the note" } },
    examples: [
      { act: "props", does: "lists every property of the note; the person's panel opens above it" },
      { act: "props full=true", does: "lists every property of the note; the person's panel fills the reader" },
    ],
    async run({ full }, { surface, host, standing }, actor) {
      if (surface.draft || surface.session) throw new ActionRefused("this reader is editing or commenting; close that first");
      // The panel holds the reader's keys: an agent reads the rows in its reply and leaves the panel be.
      if (standing) { surface.requireNote(); surface.openPanel(!!full); host.redraw(); }
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
    examples: [
      { act: "props.copy key=sun", does: "returns the sun property's value; the person's clipboard gets it too" },
      { act: "props.copy n=2", does: "returns the second property's value, as props lists them" },
    ],
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
    examples: [
      { act: "props.follow key=seed-list", does: "opens the note the seed-list property's value names" },
      { act: "props.follow n=3", does: "opens what the third property's value names, as props lists them" },
    ],
    async run({ n, key }, { surface, host, standing }, actor) {
      const { row } = await propRow(surface, n, key);
      if (!row.target) throw new ActionRefused(`${row.key} holds plain text (${row.value}); there is nothing to follow`);
      const m = await surface.followValue(row, host);
      if (!m) throw new ActionRefused(surface.panel?.note || `nothing answers at ${row.value}`);
      surface.noteAgent(actor, `followed ${row.key} to ${subject(m)}`);
      return { opened: m.id, title: subject(m) };
    },
  }),
  "props.edit": def({
    summary: "replace one property value: a properties.patch of that token, refused if the note changed since it was read", keys: [{ keys: "i tab", does: "to the properties" }, { keys: "enter e", does: "edit the value, then typing" }, { keys: "enter", does: "save" }],
    touches: "draft", draft: "write", replay: "ask",
    args: {
      ...ROW_ARGS,
      value: { type: "string", about: "the new value (one line, no ])" },
      revision: { type: "number", optional: true, about: "the revision you read the properties at; refused if the note is past it" },
    },
    examples: [
      { act: "props.edit key=status value=planted", does: "sets the note's status property to planted, as an attributed edit" },
      { act: "props.edit n=2 value=2026-03-14 revision=7", does: "sets the second property, refused if the note is past revision 7" },
    ],
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
      host.ctx.flash(`saved · revision ${saved.revision} · ${row.key}: ${printable(row.value)} → ${printable(to)}`);
      surface.noteAgent(actor, `set ${row.key} to ${to}`);
      host.redraw();
      return { saved: true, key: row.key, from: row.value, to, revision: saved.revision ?? null, fromRevision: m.revision, recordedAs: mutationFor(actor) };
    },
  }),
  "props.close": def({
    summary: "close the property panel, or its settings card (a value being typed must be saved or cancelled first)", keys: "esc, i, q; in the settings card esc, q or ,",
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
    examples: [
      { act: "props.summary keys=status,due", does: "shows status and due in the summary line, in that order" },
      { act: "props.summary toggle=owner", does: "shows the owner key in the summary line, or hides it if it is shown" },
    ],
    run({ keys, toggle, reset }, { surface, host }) {
      if ([keys, toggle, reset].filter(x => x !== undefined).length !== 1) throw new ActionRefused("pass one of keys=a,b toggle=key reset=true");
      if (toggle) surface.toggleSummary(toggle, host);
      else { setUserSummaryKeys(reset ? null : keys!.split(",").map(k => k.trim().toLowerCase()).filter(Boolean)); host.redraw(); }
      const m = surface.msg;
      return { yours: summaryKeys(null), here: m ? surface.summary(m) : null };
    },
  }),
  "settings": def({
    summary: "a configurable note's settings card (PIE-786): a rule note, a view, a callout type, a heading style or an extension's component, its fields from the component schema, each set with a picker in the power bar. The person's opens the card; an agent gets the fields (key, type, value, default, meaning, choices) to set with settings.set",
    keys: ",",
    touches: "nothing", replay: "safe",
    menu: noteRow("settings", ",", { now: ({ surface }) => (!surface.msg || surface.msg.partial || !surface.settingsSchemaOf(surface.msg) ? { hide: true } : null) }),
    args: {},
    async run(_, { surface, host, standing }, actor) {
      const typing = () => { if (surface.panel?.field) throw new ActionRefused(`a property value (${surface.panel.field.row.key}) is being typed here · enter saves it, esc cancels, then , opens the settings`); };
      if (surface.draft || surface.session) throw new ActionRefused("this reader is editing or commenting; close that first");
      typing();
      const m = await surface.whole();
      await tokensFor(m.text, surface.src);
      if (surface.src) await componentsReady(surface.src);
      typing();
      // The card holds the reader's keys: an agent reads the fields in its reply and leaves the reader be.
      const card = standing ? surface.openSettings(m) : null;
      const schemas = card?.schemas ?? surface.settingsSchemaOf(m);
      if (!schemas) surface.openSettings(m);
      host.redraw();
      // A note may be more than one thing (a view that is an EchoNet area): a section each, in the card's order.
      return { id: m.id, revision: m.revision, schema: schemas![0]!.id, schemas: schemas!.map(s => ({ id: s.id, title: s.title })), title: schemas!.map(s => s.title).join(" + "),
        fields: surface.settingFields(m, schemas!).map(f => ({
        key: f.prop.key, section: schemas![f.section]!.id, type: f.prop.type, value: f.value, meaning: f.prop.meaning,
        ...(f.prop.default !== undefined ? { default: f.prop.default } : {}),
        ...(f.prop.values ? { choices: f.prop.values.map(v => v.value) } : f.prop.samples ? { samples: f.prop.samples } : {}),
      })) };
    },
  }),
  "settings.set": def({
    summary: "set one field of a configurable note's settings card: an ordinary attributed property edit (properties.patch at the revision its tokens were read at), checked against the field's type. The person's without a value asks in the power bar with the field's picker (an enum's values, a query built over the outline's properties and values, a note, an extension's action, the writers, a duration)",
    keys: ", then enter or e on a field, or a click on the selected field",
    touches: "draft", draft: "write", replay: "ask",
    args: {
      key: { type: "string", about: "the field's key (settings lists them)" },
      value: { type: "string", optional: true, about: "its new value; left out, the person is asked in the power bar" },
    },
    examples: [
      { act: "settings.set key=direction value=asc", does: "sets a view to ascending order" },
      { act: "settings.set key=limit value=20", does: "sets the limit field to 20, refused if the value does not fit its type" },
    ],
    async run({ key, value }, { surface, host }, actor) {
      if (surface.draft || surface.session) throw new ActionRefused("this reader is editing or commenting; close that first");
      const m = await surface.whole();
      await tokensFor(m.text, surface.src);
      const schema = surface.settingsSchemaOf(m);
      if (!schema) throw new ActionRefused("this note isn't configured by a component (settings says which notes are)");
      const fields = surface.settingFields(m, schema);
      const field = fields.find(f => f.prop.key === key.trim().toLowerCase());
      if (!field) throw new ActionRefused(`${schema.map(s => s.title).join(" + ")} has no field ${key}; its fields are ${fields.map(f => f.prop.key).join(", ")}`);
      const write = async (answer: string) => {
        const to = settingValue(field, answer);
        const why = settingProblem(field, to);
        if (why) throw new ActionRefused(why);
        if (to === field.value) {
          // Unchanged only if the note still is as it was read (it may have moved on while the person chose).
          const now = await host.ctx.board.get(m.id);
          if (now?.revision !== m.revision) throw new ActionRefused("the note changed elsewhere since its settings were read · not saved; open them again (settings)");
          return { saved: false, unchanged: true, key: field.prop.key, revision: m.revision };
        }
        let saved: Msg;
        try { saved = await surface.writeSetting(m, field.prop.key, to, host, actor); } catch (e) {
          throw e instanceof ActionRefused ? e : new ActionRefused(e instanceof EditConflict ? "the note changed elsewhere since its settings were read · not saved; open them again (settings)" : `not saved: ${e instanceof Error ? e.message : String(e)}`);
        }
        const said = `saved · ${field.prop.key}: ${field.value === null ? "unset" : printable(field.value)} → ${printable(to)}`;
        if (surface.panel?.card) surface.panel.card.note = said;
        host.ctx.flash(said);
        surface.noteAgent(actor, `set ${field.prop.key} to ${to}`);
        host.redraw();
        return { saved: true, key: field.prop.key, from: field.value, to, revision: saved.revision ?? null, recordedAs: mutationFor(actor) };
      };
      if (value !== undefined) return write(value);
      if (actor.kind !== "user") {
        const p = field.prop;
        throw new ActionRefused(`say value=…: ${p.key} is ${p.type}${p.values ? ` (one of ${p.values.map(v => v.value).join(", ")})` : p.samples ? ` (like ${p.samples.join(", ")})` : ""}: ${p.meaning}`);
      }
      return askInBar(host.ctx as never, `${schema[field.section]!.title} · ${field.prop.key}`, [settingQuestion(field, surface.settingSources(host))], {}, actor, answers => write(answers[field.prop.key] ?? ""));
    },
  }),
  "settings.clear": def({
    summary: "clear one field of a configurable note's settings card (its property taken out of the note, so its default holds): one attributed properties.patch",
    keys: ", then x or delete on a field",
    touches: "draft", draft: "write", replay: "ask",
    args: { key: { type: "string", about: "the field's key (settings lists them)" } },
    examples: [
      { act: "settings.clear key=sort", does: "takes the sort property out of the note, so its default holds" },
    ],
    async run({ key }, { surface, host }, actor) {
      if (surface.draft || surface.session) throw new ActionRefused("this reader is editing or commenting; close that first");
      const m = await surface.whole();
      await tokensFor(m.text, surface.src);
      const schema = surface.settingsSchemaOf(m);
      if (!schema) throw new ActionRefused("this note isn't configured by a component (settings says which notes are)");
      const field = surface.settingFields(m, schema).find(f => f.prop.key === key.trim().toLowerCase());
      if (!field) throw new ActionRefused(`${schema.map(s => s.title).join(" + ")} has no field ${key}`);
      // A key any of its components declares or requires (a view's query, an area's echo) is what makes it one.
      const own = schema.find(s => s.source.note?.name === field.prop.key || (s.source.note?.requires ?? []).includes(field.prop.key));
      if (own) throw new ActionRefused(`${field.prop.key} is what makes this note a ${own.title.toLowerCase().replace(/s$/, "")}: clearing it would undo that · e edits the note`);
      if (field.value === null) return { cleared: false, key: field.prop.key, unset: true };
      let saved: Msg;
      try { saved = await surface.writeSetting(m, field.prop.key, null, host, actor); } catch (e) {
        throw e instanceof ActionRefused ? e : new ActionRefused(`not cleared: ${e instanceof Error ? e.message : String(e)}`);
      }
      const said = `cleared · ${field.prop.key}${field.prop.default !== undefined ? ` (now its default, ${field.prop.default})` : ""}`;
      if (surface.panel?.card) surface.panel.card.note = said;
      host.ctx.flash(said);
      surface.noteAgent(actor, `cleared ${field.prop.key}`);
      host.redraw();
      return { cleared: true, key: field.prop.key, from: field.value, revision: saved.revision ?? null };
    },
  }),
  "decor.raw": def({
    summary: "the note as written, without what the outline's rules draw on it (PIE-600: a heading's band, a meeting's card, a shouted line), or (on=false, or ~ again) with it. The reader's own state: the note is never written",
    keys: "~",
    touches: "tile", replay: "safe", way: "peek's decorations say what is drawn; open the note in a reader of your own to see it raw",
    args: { on: { type: "boolean", optional: true, about: "true: raw; false: decorated; absent: the other one" } },
    examples: [
      { act: "decor.raw on=true", does: "shows the note as written, without what the rules draw on it" },
      { act: "decor.raw", does: "switches between the note as written and the decorated note" },
    ],
    run({ on }, { surface, host }) {
      const m = surface.requireNote();
      surface.raw = on ?? !surface.raw;
      host.ctx.flash(surface.raw ? "raw: the note as written · R draws the rules' decorations again" : "decorated: what the rules draw · R shows the note as written");
      host.redraw();
      return { raw: surface.raw, decorations: surface.raw ? 0 : decorationsOf(m, surface.src).length };
    },
  }),
  "fold.select": def({
    words: "move the ( ) fold selection to the next or previous heading, list item or callout",
    summary: "put the person's ( ) fold selection on the next (by=1) or previous (by=-1) heading, list item or callout drawn; f or enter then folds it. The person's reading state: an agent's is refused (fold, unfold and fold.toggle name a fold point)", keys: "( )",
    touches: "tile", replay: "safe", person: "the ( ) selection is the person's; fold, unfold and fold.toggle name a fold point (folds lists them)",
    args: { by: { type: "number", about: "1 the next fold point, -1 the previous one" } },
    examples: [
      { act: "fold.select by=1", does: "puts the ( ) selection on the next heading, list item or callout" },
      { act: "fold.select by=-1", does: "puts the ( ) selection on the previous one" },
    ],
    run({ by }, { surface, host }, actor) {
      const m = surface.requireNote();
      if (m.partial || !surface.stepFold(by < 0 ? -1 : 1)) throw new ActionRefused("this note has no headings, nested lists or callouts to fold");
      host.redraw();
      return surface.describe().folds ?? null;
    },
  }),
  "reading.step": def({
    summary: "move within a live figure or links list by rows, keeping its boundary until Esc; elsewhere move the reading line by logical blocks, a screen at a time in a tall block",
    touches: "tile", replay: "safe", person: "the reading position belongs to the person", keys: "↑ ↓ j k",
    args: { by: { type: "number", about: "1 next block, -1 previous block" } },
    examples: [
      { act: "reading.step by=1", does: "moves the reading line to the next block of the note" },
      { act: "reading.step by=-1", does: "moves the reading line back to the previous block" },
    ],
    run({ by }, { surface, host }) {
      surface.requireNote();
      if (by !== 1 && by !== -1) throw new ActionRefused("by is 1 or -1");
      surface.stepReading(by); surface.previewRow(host); host.redraw();
      return { position: surface.position.reading };
    },
  }),
  "reading.place": def({
    summary: "put the reading position on a source line; the next edit starts there without scrolling the page",
    touches: "tile", replay: "safe", person: "the reading position belongs to the person", keys: "click note text",
    args: { line: { type: "number", about: "source line, from 1" } },
    examples: [
      { act: "reading.place line=12", does: "puts the reading position on note line 12, without scrolling the page" },
    ],
    run({ line }, { surface }) {
      const m = surface.requireNote();
      if (!Number.isInteger(line) || line < 1 || line > m.text.split("\n").length) throw new ActionRefused("line must name a source line in this note");
      surface.anchorView();
      surface.letGo();
      surface.readingLine(line - 1);
      return { line };
    },
  }),
  "scroll": def({
    summary: "scroll the reader's note by rows (by=, negative is up) or to=top / to=end (the last line to the bottom edge; again, past the end as reader.overscroll allows, to the middle by default); the person's [ ] position is let go, as their own scrolling does. An agent's is refused on the reader the person has focused (view.scrollTo on the desk scrolls without touching their position)", keys: "j k ↑ ↓, PgUp PgDn, space, Home End G, wheel",
    touches: "tile", replay: "safe", way: "its scroll is theirs; an agent scrolls a reader with view.scrollTo (desk), which leaves their [ ] position alone",
    args: {
      by: { type: "number", optional: true, about: "rows to scroll; negative scrolls up" },
      to: { type: "string", optional: true, about: "top or end" },
    },
    examples: [
      { act: "scroll by=10", does: "scrolls the note down ten rows" },
      { act: "scroll to=end", does: "scrolls until the last line is at the bottom edge" },
    ],
    run({ by, to }, { surface, host, standing }, actor) {
      if (to !== undefined && to !== "top" && to !== "end") throw new ActionRefused(`to is top or end, not ${to}`);
      if ((by === undefined) === (to === undefined)) throw new ActionRefused("say by= (rows) or to=top|end");
      surface.requireNote();
      // The person's own scrolling lets go of their [ ] position; an agent's never touches it.
      if (to === "end") surface.scrollEnd(standing);
      else surface.scrollBy(to === "top" ? -1e9 : by!, standing);
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
    examples: [
      { act: "callouts show=true", does: "opens every callout in the note" },
      { act: "callouts show=false", does: "puts the callouts back as written, the [!type]- ones folded" },
    ],
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
  "list.preview.scroll": def({
    summary: "scroll the selected item's children inside their fixed preview", keys: "wheel over the children",
    touches: "tile", person: "the preview scroll belongs to the person", replay: "safe",
    args: { by: { type: "number", about: "rows to scroll" } },
    examples: [{ act: "list.preview.scroll by=3", does: "scrolls three rows inside the children preview" }],
    run: ({ by }, { surface, host }) => { const p = surface.listPreview; p.top = Math.max(0, Math.min(p.max, p.top + by)); host.redraw(); return { top: p.top }; },
  }),
  "list.preview.edit": def({
    summary: "edit the selected item's children in the shared editor; a save patches only their lines",
    touches: "draft", draft: "write", replay: "ask", keys: "click the children preview",
    args: { text: { type: "string", optional: true, about: "replacement source for the children; left out opens the editor" } },
    examples: [{ act: 'list.preview.edit text="  - New detail"', does: "patches the selected item's children" }],
    run: ({ text }, { surface, host }, actor) => surface.editListPreview(host, actor, text),
  }),
  "list.preview.field": def({
    summary: "type, save or leave the children edit", touches: "draft", person: "the children edit belongs to the person", replay: "ask",
    args: { op: { type: "string", about: "key, text, save or cancel" }, value: { type: "string", optional: true, about: "key name or typed text" } },
    examples: [{ act: "list.preview.field op=save", does: "saves the children edit through its patch" }],
    run: (a, { surface, host }) => surface.listPreviewField(a, host),
  }),
  "list.preview.place": def({
    summary: "place the selected list item's children using the reader's attachment placements",
    touches: "tile", person: "the preview placement belongs to the person", replay: "ask",
    args: { place: { type: "string", optional: true, about: "inline, floating, split, popup or tile" }, side: { type: "string", optional: true, about: "left, right, up or down for its tile" } },
    examples: [{ act: "list.preview.place place=split", does: "shows the children beside or below the list" }],
    run: ({ place, side }, { surface, host }) => {
      if (side !== undefined && !["left", "right", "up", "down"].includes(side)) throw new ActionRefused("side is left, right, up or down");
      return surface.placeListPreview(place, host, side as AttachedSide | undefined);
    },
  }),
  "list.preview": def({
    summary: "show this list's selected item's children in an attached preview; reading state only",
    keys: [{ keys: "p", does: "fold chip", says: "preview the children of the selected list item" }, { via: "reader menu" }], touches: "tile", while: "typing", replay: "safe",
    menu: noteRow("preview list children", ""),
    args: { ...FOLD_ARGS, on: { type: "boolean", optional: true, about: "preview children instead of unfolding in place" } },
    examples: [{ act: 'list.preview text="Keep the beans" on=true', does: "previews the children of this list" }],
    async run({ on, ...which }, { surface, host }, actor) {
      const p = Object.values(which).some(v => v !== undefined) ? await foldTarget(surface, which) : surface.foldTargetAtKeys();
      if (!p) throw new ActionRefused("select a list item with children first");
      const out = surface.toggleListPreview(p, on); surface.noteAgent(actor, "changed list preview"); host.redraw(); return out;
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
      return { folds: points.map((p, i) => ({ n: i + 1, kind: p.kind, level: p.level, text: p.text, line: lines[p.line]! + 1, hidden: p.hidden, folded: surface.effectiveFolded(p), shown: shown.has(p.key) })) };
    },
  }),
  "fold": def({
    summary: "fold a heading (hiding through the next heading of its level or higher) , a list item (hiding its nested items and continuation lines) or a callout (to its title); all=true folds every outermost one (F when nothing is folded). Reading state only: the note's text never changes", keys: "( ) then f or enter, click, F",
    touches: "tile", while: "typing", replay: "safe", way: "an agent folds a reader the person isn't typing in",
    args: { ...FOLD_ARGS, all: { type: "boolean", optional: true, about: "fold every outermost heading and list item" } },
    examples: [
      { act: "fold text=\"Planting dates\"", does: "folds the Planting dates heading, hiding its section" },
      { act: "fold all=true", does: "folds every outermost heading and list item" },
    ],
    run: (args, on, actor) => runFold(true, args, on, actor),
  }),
  "unfold": def({
    summary: "unfold a heading, list item or callout; all=true unfolds everything (F when something is folded)", keys: "( ) then f or enter, click, F",
    touches: "tile", while: "typing", replay: "safe", way: "an agent unfolds a reader the person isn't typing in",
    args: { ...FOLD_ARGS, all: { type: "boolean", optional: true, about: "unfold everything in this reader" } },
    examples: [
      { act: "unfold line=14", does: "unfolds the heading or list item on note line 14" },
      { act: "unfold all=true", does: "unfolds every heading, list item and callout in this reader" },
    ],
    run: (args, on, actor) => runFold(false, args, on, actor),
  }),
  "fold.toggle": def({
    summary: "fold a heading, list item or callout, or unfold it if it's folded; with none named, the person's: the one ( ) selected, else the section being read", keys: "f, enter, click",
    touches: "tile", while: "typing", replay: "safe", way: "an agent folds a reader the person isn't typing in",
    args: FOLD_ARGS,
    examples: [
      { act: "fold.toggle text=\"Seed list\"", does: "folds the Seed list heading, or unfolds it if it is folded" },
      { act: "fold.toggle n=2", does: "toggles the second fold point, as folds lists them" },
    ],
    async run(args, { surface, host, standing }, actor) {
      const none = args.text === undefined && args.line === undefined && args.n === undefined;
      const draft = surface.draft;
      if (draft) {
        const points = draft.answerFolds();
        const p = args.n !== undefined ? points[args.n - 1] : points.find(p => args.text !== undefined ? p.text === args.text : p.line === (args.line ?? draft.row + 2) - 1);
        if (!p) throw new ActionRefused("name an answer fold in the draft by its line or number");
        const folded = draft.toggleAnswer(p);
        host.redraw();
        return { line: p.line + 1, folded };
      }
      if (none && !standing) throw new ActionRefused("say which heading, list item or callout: one of text=, line= or n= (folds lists them)");
      const at = none ? surface.foldTargetAtKeys() : null;
      if (none && !at) throw new ActionRefused("nothing to fold here · ( ) pick a heading or a list item");
      const now = surface.msg;
      const p = at ?? (now && !now.partial ? foldPointIn(surface, now, args) : await foldTarget(surface, args));
      const on = !surface.effectiveFolded(p);
      surface.setFold(p, on, standing);
      surface.noteAgent(actor, `${on ? "folded" : "unfolded"} ${foldLabel(p)}`);
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
    examples: [
      { act: "figure.tab n=2", does: "shows the second tab of the note's tabs figure" },
      { act: "figure.tab by=1 figure=\"Beds by stage\"", does: "shows the next tab of the figure titled Beds by stage" },
    ],
    run({ n, by, tab, figure }, { surface, host, standing }, actor) {
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
      surface.setFigureTab(f, t.value, standing, host);
      surface.noteAgent(actor, `showed the ${t.value} tab of ${f.title}`);
      host.redraw();
      return { figure: f.n, title: f.title, tab: t.value, count: t.count, tabs: tabs.map((x, j) => ({ n: j + 1, ...x, shown: x === t })) };
    },
  }),
  "figure.density": def({
    summary: "draw a live table or tabs figure's rows compact (one line a title, cut with …), cozy (titles up to two lines, cut with …) or comfortable (up to three lines, a blank line between rows): to= sets it, else the next one round; a wrapped title hangs under its text, past a work id. figure= as figure.tab. Reading state: the figure's density: line is only where it starts, and the note never changes",
    keys: "= while a figure's tab or row is the [ ] position, ⏎ on its ≡ control, click it",
    touches: "tile", while: "typing", replay: "safe", way: "an agent changes the density in a reader the person isn't typing in",
    args: {
      to: { type: "string", optional: true, about: "compact, cozy or comfortable; left out, the next one round" },
      figure: { type: "string", optional: true, about: "which table or tabs figure: its number among the note's figures (figures lists them), or its title" },
    },
    examples: [
      { act: "figure.density to=compact", does: "draws the figure's rows one line a title, cut with …" },
      { act: "figure.density figure=2", does: "moves the second figure to the next density round" },
    ],
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
    summary: "select text in the note as the reader draws it: text= (links read as their titles) or line= to= (1 is the subject). An agent's selection is its own, drawn in its own tint; the person's is never touched", keys: [{ keys: "drag", does: "select" }, { keys: "double-click", does: "selects a word" }, { via: "a triple click" }, { keys: "v then h j k l", does: "select with the keys" }],
    touches: "nothing", replay: "safe",
    args: {
      text: { type: "string", optional: true, about: "the words as they're drawn (blanks and row breaks match any blank)" },
      line: { type: "number", optional: true, about: "the first note line to select (1 is the subject)" },
      to: { type: "number", optional: true, about: "with line: the last note line" },
      n: { type: "number", optional: true, about: "with text: which time it's drawn, from 1" },
    },
    examples: [
      { act: "select text=\"seed packets\"", does: "selects the words seed packets as the note draws them" },
      { act: "select line=3 to=5", does: "selects note lines 3 to 5" },
    ],
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
  "blocks": def({
    summary: "list the code blocks, quotes and callouts this reader draws, in reading order: number, kind, size, note lines and first words (the current one marked). block.copy n= copies one's content",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { surface }) {
      await surface.whole();
      surface.requireDrawn();
      return { blocks: surface.describeBlocks() };
    },
  }),
  "block.copy": def({
    summary: "copy a code block's, quote's or callout's content as written: a fence's lines without the fence, a quote's lines without the > markers, a callout's body without its marker line (inner Markdown kept). The person's goes to their clipboard (OSC 52) and the status line says \"copied N lines\"; an agent's is returned to it and never touches the person's clipboard",
    keys: "y or cmd+c on the current element ([ ] to the block, or anything in it), ⏎ on a block element, a click on its ⧉ control",
    touches: "nothing", replay: "safe",
    args: {
      n: { type: "number", optional: true, about: "which block, from 1, as blocks lists them; default the block the person's current element is in" },
      element: { type: "number", optional: true, about: "or the block the nth element (elements lists them) is, or is in: an inline code span is one" },
    },
    examples: [
      { act: "block.copy n=1", does: "copies the first code block, quote or callout's content, as written" },
      { act: "block.copy element=4", does: "copies the block the fourth element is, or is in" },
    ],
    async run({ n, element }, { surface, host }, actor) {
      if (actor.kind === "agent") await surface.whole();
      if (n !== undefined && element !== undefined) throw new ActionRefused("say n or element, not both");
      const r = surface.copyBlock(n ?? (element !== undefined ? surface.blockNumberOf(element) : undefined), host, actor);
      host.redraw();
      return r;
    },
  }),
  "note.copy": def({
    summary: "copy the whole note as stored (header chips, fences and all) with each live figure's results under it as Markdown (PIE-1355: a checklist as - [ ]/- [x] steps, a table as a table, tabs a list per group, links ((id|title)); at most 50 rows a figure, a cut said with the ep0ch find command that reads the rest); source=true copies the text alone. The person's goes to their clipboard (OSC 52) and the status line says \"copied the page with N figures' results (K cut)\"; an agent's is returned to it and never touches the person's clipboard",
    keys: [{ keys: "Y", does: "with nothing selected" }, { via: "the tile menu's \"copy note\" (and \"copy source only\")" }],
    touches: "nothing", replay: "safe",
    menu: [noteRow("copy note", "Y"), { ...noteRow("copy source only", "", {}), args: { source: true } }],
    args: { source: { type: "boolean", optional: true, about: "the note's text alone, without its figures' results" } },
    examples: [{ act: "note.copy", does: "answers the note's text with its live figures' results" }, { act: "note.copy source=true", does: "answers the note's text as stored" }],
    async run({ source }, { surface, host }, actor) {
      const r = await surface.copyNote(host, actor, source === true);
      host.redraw();
      return r;
    },
  }),
  "select.copy": def({
    summary: "copy the selection: what's drawn, or source=true for its markup. The person's goes to their clipboard (OSC 52), and a selection they make with the mouse is copied when the button comes up (copy on select; EP0CH_COPY_ON_SELECT=0 turns it off); an agent's is returned to it and never touches the person's clipboard", keys: [{ keys: "y Y cmd+c", does: "copy" }, { keys: "click", does: "the [y copy] control" }, { keys: "drag", does: "the release of a drag copies (or a double or triple click)" }],
    touches: "nothing", replay: "safe",
    args: { source: { type: "boolean", optional: true, about: "the note's own text (markup) instead of what's drawn" } },
    examples: [
      { act: "select.copy", does: "copies the selected words as the note draws them" },
      { act: "select.copy source=true", does: "copies the selection's markup instead of what is drawn" },
    ],
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
    summary: "set a checklist step's status (done, todo, waiting, problem, approved, rejected: approved is the person's yes) through checklist.update, checked against the step as it was read; recorded as whoever asks (an agent by its id) and said on screen. Works on steps inside embeds: the change is to the note the step is in",
    keys: [{ keys: "[ ]", does: "to a step" }, { keys: "⏎ click", does: "on its box opens the status choice" }, { keys: "x o + - w !", does: "set the status in the choice" }, { keys: "space", does: "toggles done / to do" }, { via: "with no step named, the person's: the status choice open, else the step that is the current element" }],
    touches: "draft", draft: "write", replay: "ask",
    args: { ...STEP_ARGS, to: { type: "string", about: "done, todo, waiting, problem, approved or rejected (or a box's mark: x, space, ~, !, ✓ or +, ✗ or -)" } },
    examples: [
      { act: "task.status n=2 to=done", does: "marks the second checklist step done" },
      { act: "task.status id=t-8a6d7f to=waiting", does: "sets the step with that id to waiting" },
    ],
    async run({ to, ...which }, { surface, host }, actor) {
      const status = parseStatus(to);
      if (!status) throw new ActionRefused(`to is done, todo, waiting, problem, approved or rejected, not ${JSON.stringify(to)}`);
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
    examples: [
      { act: "callout.menu n=1", does: "opens the type choice under the first callout's top edge" },
    ],
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
    keys: [{ keys: "⏎ click", does: "opens the type choice, on a callout's icon or type" }, { keys: "⏎", does: "in the type choice picks it" }],
    touches: "draft", draft: "write", replay: "ask",
    args: { ...CALLOUT_ARGS, to: { type: "string", about: "the type to write: a name or alias the outline has (callout.list), or a new name" } },
    examples: [
      { act: "callout.type n=1 to=warning", does: "rewrites the first callout's header to [!warning]" },
      { act: "callout.type line=12 to=tip", does: "changes the callout whose header is on line 12 to a tip" },
    ],
    async run({ to, ...which }, { surface, host }, actor) {
      const name = to.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) throw new ActionRefused(`to is a type's name (letters, digits, - and _), not ${JSON.stringify(to)}`);
      const c = await surface.calloutNamed(which, actor);
      return surface.changeCallout(c, { type: name }, host, actor);
    },
  }),
  "callout.start": def({
    summary: "make a callout start folded (folded=true writes [!type]-) or open (folded=false writes [!type]+): the one change to the text that folding ever makes, through the note's save like callout.type. Folding it in a reader is fold or f, which never writes",
    keys: [{ keys: "- +", does: "in the type choice" }],
    touches: "draft", draft: "write", replay: "ask",
    args: { ...CALLOUT_ARGS, folded: { type: "boolean", about: "true: it starts folded (-); false: it starts open (+)" } },
    examples: [
      { act: "callout.start n=2 folded=true", does: "makes the second callout start folded, writing [!type]-" },
      { act: "callout.start n=2 folded=false", does: "makes the second callout start open, writing [!type]+" },
    ],
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
  "artifact.open": def({
    summary: "open an artifact (PIE-793: an [artifact::path] line, a .jsx, .html, .svg or .mermaid file claude.ai would run) running on its web page, in the person's browser; an agent is given its address instead. n= as images lists them, or line=; left out, the one that's the [ ] position",
    keys: "⏎ while an artifact's card is the [ ] position, a click on its card or its [open ↗]",
    touches: "nothing", replay: "safe",
    args: { ...IMAGE_ARGS },
    examples: [
      { act: "artifact.open n=1", does: "opens the first artifact on its web page; an agent is given the address" },
    ],
    async run(which, { surface, host }, actor) {
      const ref = await surface.imageNamed(which, actor);
      if (ref.spec.kind !== "artifact") throw new ActionRefused("that's an image, not an artifact: element.open opens it in the system viewer");
      return surface.openArtifact(ref, host);
    },
  }),
  "artifact.share": def({
    summary: "share an artifact on its own (PIE-1266): a link anyone can open, that shows that artifact and nothing else, ends by itself after ttl= (1h by default; never keeps it until revoked) and is ended with share.revoke. The link is copied for the person; an agent is given it in the answer. n= as images lists them, or line=; left out, the one that's the [ ] position",
    keys: "a click on its card's [share]",
    touches: "nothing", replay: "ask",
    args: { ...IMAGE_ARGS, ttl: { type: "string", optional: true, about: "how long it lives: 30m, 1h (the default), 2h30m, up to 24h, or never" } },
    examples: [
      { act: "artifact.share n=1 ttl=never", does: "shares the first artifact on its own until it is revoked, and copies the link" },
    ],
    async run({ ttl, ...which }, { surface, host }, actor) {
      const ref = await surface.imageNamed(which, actor);
      if (ref.spec.kind !== "artifact") throw new ActionRefused("that's an image, not an artifact: share.start shares notes");
      return surface.shareArtifact(ref, ttl, host, actor);
    },
  }),
  "image.size": def({
    summary: "size an image (PIE-532): to= its width (cells, N% of the reader, full, or none for its own), height= its rows (a number, or none), or by=1|-1 one step (a quarter, a third, a half, two thirds, three quarters, full; on the header, its height by the steps image.look prop=height takes). Its aspect is kept. Written as [size::…] [height::…] on its line through the note's save, checked against the line as drawn and the revision read now, recorded as whoever asks; ctrl+z (image.undo) puts it back",
    keys: "+ - while an image is the [ ] position, a click on its caption's − or +",
    touches: "draft", draft: "write", replay: "ask",
    args: {
      ...IMAGE_ARGS,
      to: { type: "string", optional: true, about: "its width: cells (40), a share of the reader (50%), full, or none" },
      height: { type: "string", optional: true, about: "its height in rows (12), or none" },
      by: { type: "number", optional: true, about: "1 a step bigger, -1 a step smaller" },
    },
    examples: [
      { act: "image.size n=1 to=50%", does: "sizes the first image to half the reader's width" },
      { act: "image.size line=8 by=1", does: "makes the image on line 8 one step bigger" },
    ],
    async run({ to, height, by, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        if (to === undefined && height === undefined && by === undefined) throw new ActionRefused("say to= (a width: 40, 50% or full), height= (rows) or by=1|-1");
        if (by !== undefined && by !== 1 && by !== -1) throw new ActionRefused(`by is 1 or -1 (a step), not ${by}`);
        if (by !== undefined && (to !== undefined || height !== undefined)) throw new ActionRefused("say by= alone, or to= and height=");
        const ref = await surface.imageNamed(which, actor), hero = ref.spec.layout === "hero";
        const set: Partial<Record<MediaAttr, string | null>> = {};
        if (by !== undefined && hero) {
          // The same steps as the tune's height row (outline-core's HERO_PROPS), a share by shares.
          set.height = heroPropStep("height", heroPropText(ref.spec, "height") ?? String(surface.heroRowsDrawn() ?? HERO_ROWS), by);
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
    examples: [
      { act: "image.align n=1 to=center", does: "centres the first image in the reader" },
      { act: "image.align n=2 by=1", does: "moves the second image one place right" },
    ],
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
    examples: [
      { act: "image.hero n=1 on=true", does: "makes the first image the note's header, above the title" },
      { act: "image.hero n=1 on=false", does: "turns the header image back into an image in the text" },
    ],
    async run({ on, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        const ref = notArtifact(await surface.imageNamed(which, actor));
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
    examples: [
      { act: "image.fit n=1 to=contain", does: "shows the header image whole, centred" },
      { act: "image.fit n=1", does: "switches the header image between cropped to fill and shown whole" },
    ],
    async run({ to, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        const ref = notArtifact(await surface.imageNamed(which, actor));
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
    examples: [
      { act: "image.dim n=1 to=0.4", does: "dims the first image by 0.4, writing [dim::0.4] on its line" },
      { act: "image.dim n=1 to=auto", does: "dims the first image only as far as a bright one needs" },
    ],
    async run({ to, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        const v = to.trim().toLowerCase();
        const d = v === "auto" ? null : parseDim(v);
        if (v !== "auto" && d === null) throw new ActionRefused(`to is a number from 0 (as it is) to 1 (black), or auto; not ${JSON.stringify(to)}`);
        const ref = notArtifact(await surface.imageNamed(which, actor));
        return surface.changeImage(ref, { dim: d === null ? null : String(d) }, d === null ? "dimmed as bright images are" : `dim ${d}`, host, actor);
      });
    },
  }),
  "image.look": def({
    summary: "change the note's header image's look (PIE-1361): prop= one of HERO_PROPS (height, focus.x, focus.y, fit, dim, tint, fade, blur, bleed, title, scroll) with to= a value (none takes it off the line: the built-in) or by=1|-1 a step; or focus=x,y for both halves at once. Written as that property on the hero's own line ([tint::0.5], [hero-focus::0.3,0.6]) through the note's save, checked against the line as drawn, recorded as whoever asks; ctrl+z (image.undo) puts it back. The tune's hero rows and the header's drags run this",
    keys: [{ keys: "− + ×", does: "the tune's hero rows" }, { keys: "wheel", does: "the tune's hero rows" }, { keys: "drag", does: "inside the header picture (focus)" }],
    touches: "draft", draft: "write", replay: "ask",
    args: {
      ...IMAGE_ARGS,
      prop: { type: "string", optional: true, about: "height, focus.x, focus.y, fit, dim, tint, fade, blur, bleed, title or scroll" },
      to: { type: "string", optional: true, about: "its value, or none" },
      by: { type: "number", optional: true, about: "1 a step up, -1 a step down" },
      focus: { type: "string", optional: true, about: "x,y: the point the crop keeps in view, each 0 to 1" },
    },
    examples: [
      { act: "image.look prop=tint to=0.5", does: "tints the header picture halfway toward the tile's tone, writing [tint::0.5] on its line" },
      { act: "image.look prop=title by=1", does: "puts the title over the picture's bottom ([title::over])" },
      { act: "image.look focus=0.3,0.7", does: "keeps the point 30% across and 70% down in view ([hero-focus::0.3,0.7])" },
    ],
    async run({ prop, to, by, focus, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        const named = which.n !== undefined || which.line !== undefined ? await surface.imageNamed(which, actor) : surface.heroRef(await surface.whole());
        if (!named) throw new ActionRefused("this note has no header image: H on an image (image.hero) makes it one");
        const ref = notArtifact(named);
        if (ref.spec.layout !== "hero") throw new ActionRefused(`the image on line ${ref.line + 1} isn't the header: image.look changes the header's ([layout::hero]); image.hero makes it one`);
        if (focus !== undefined) {
          if (prop !== undefined || to !== undefined || by !== undefined) throw new ActionRefused("say focus=x,y alone, or prop= with to= or by=");
          const f = parseFocus(focus);
          if (!f) throw new ActionRefused(`focus is x,y, each 0 to 1 (0.3,0.7); not ${JSON.stringify(focus)}`);
          const r = (x: number) => String(Math.round(x * 100) / 100);
          return surface.changeImage(ref, { "hero-focus": `${r(f.x)},${r(f.y)}` }, `focus ${r(f.x)},${r(f.y)}`, host, actor);
        }
        if (prop === undefined || !isHeroProp(prop)) throw new ActionRefused(`prop is one of ${HERO_PROP_NAMES.join(", ")}`);
        if ((to === undefined) === (by === undefined)) throw new ActionRefused("say to= (a value, or none) or by=1|-1");
        if (by !== undefined && by !== 1 && by !== -1) throw new ActionRefused(`by is 1 or -1 (a step), not ${by}`);
        const drawnRows = prop === "height" && ref.spec.height === undefined ? surface.heroRowsDrawn() : null;
        // A height left out steps from the rows drawn (or, none drawn, the reader's usual header).
        const value = to ?? heroPropStep(prop, heroPropText(ref.spec, prop) ?? (prop === "height" ? String(drawnRows ?? HERO_ROWS) : undefined), by!);
        const r = heroPropSet(ref.spec, prop, value);
        if ("problem" in r) throw new ActionRefused(r.problem);
        return { ...(await surface.changeImage(ref, r.set, `${prop} ${value === "none" ? `as built in (${HERO_PROPS[prop].none})` : value}`, host, actor)), prop, value };
      });
    },
  }),
  "ext.undo": def({
    summary: "undo the last extension action run on this note (PIE-784: its write group, whole: the blocks it made to the Trash, its edits, moves and orders put back), or the last quote of its marks (the quoting block to the Trash), as whoever ran it (an agent undoes its own, the person theirs); refused, with nothing changed, if any of it changed since",
    keys: "ctrl+z (when an extension action or a quote was the last change made here)",
    touches: "nothing", replay: "ask",
    args: {},
    run: (_, { surface, host }, actor) => surface.undoExtension(host, actor),
  }),
  "script.stop": def({
    summary: "stop one running script by its run id (run=: the undo a script run answered with, also its run note's [script-run::…]): its remaining calls are refused and the run note says who stopped it. Writes it already made stay; ext.undo takes them back. Says so when the run isn't running",
    keys: [{ via: "act, or the power bar" }],
    touches: "nothing", replay: "ask",
    args: { run: { type: "string", about: "the run's id (its undo)" } },
    examples: [
      { act: "script.stop run=4f7c2a19-8b3e-4d60-9a15-c2e7d08b6f31", does: "stops that running script; its remaining calls are refused" },
    ],
    async run({ run }, { host }, actor) {
      if (!run?.trim()) throw new ActionRefused("script.stop needs run=<the run's id>: the undo a script run answered with");
      const r = await host.ctx.board.stopScript(run.trim(), actor);
      asActor(host.ctx, actor).flash(r.stopped ? "stopped the script" : "that script isn't running");
      host.redraw();
      return r;
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
    keys: [{ keys: "y", does: "in the status choice: Copy step link" }, { keys: "a", does: "in the status choice: Make addressable" }],
    touches: "draft", draft: "write", replay: "ask",
    args: { ...STEP_ARGS, copy: { type: "boolean", optional: true, about: "false: only give the step a stable id, copying nothing" } },
    examples: [
      { act: "task.link n=2", does: "gives the second step an id if it has none and returns its link" },
      { act: "task.link n=2 copy=false", does: "only gives the second step a stable id, copying nothing" },
    ],
    async run({ copy, ...which }, { surface, host }, actor) {
      const e = surface.stepFor(which, actor) ?? (await surface.whole(), surface.stepNamed(which));
      return surface.changeStep(e.task!, copy === false ? "address" : "copy-link", host, actor);
    },
  }),
  "use.fill": def({
    words: "fill in what a ::use template asks for",
    summary: "give a ::use the props its template needs (PIE-533): the person is asked for each in the power bar, in the picker of its kind (a choice's options, a note found by its words), then the answers are written onto the call's line through the note's save, checked against the line as drawn, recorded as whoever asks; ctrl+z (use.undo) takes them back. An agent names them: with='{\"owner\":\"ada\"}' (it is never asked, and its fill never takes the person's focus). line= which ::use (from 1; default: the only one)",
    keys: "⏎ or a click on a ::use's “needs …” line",
    touches: "draft", draft: "write", replay: "ask",
    args: {
      block: { type: "string", optional: true, about: "the note the ::use is written in, when it is drawn inside this one (an embed, a template): default the note shown" },
      line: { type: "number", optional: true, about: "the line of the ::use, from 1 (default: the only one the note has)" },
      with: { type: "string", optional: true, about: "the props to write, as JSON: names to text (an agent's; the person is asked for the rest)" },
    },
    examples: [
      { act: "use.fill line=9 with='{\"owner\":\"ada\"}'", does: "writes owner=ada onto the ::use on line 9, which needs it" },
    ],
    async run({ block, line, with: w }, { surface, host }, actor) {
      let given: Record<string, string> = {};
      if (w !== undefined) {
        let v: unknown;
        try { v = JSON.parse(w); } catch { throw new ActionRefused("with= is JSON: the props to write, names to text; for example with='{\"owner\":\"ada\"}'"); }
        if (!v || typeof v !== "object" || Array.isArray(v) || Object.values(v).some(x => typeof x !== "string")) throw new ActionRefused("with= maps names to text; for example with='{\"owner\":\"ada\"}'");
        given = v as Record<string, string>;
      }
      return surface.fillUse(block, line, given, host, actor);
    },
  }),
  "sources.open": def({
    summary: "open the Sources inspector on this note (PIE-956): every generated region (handler lines, ::=, ::use, figures, ::fields, ::if, written output) with when it last read, from the service's one answer (site.sources), beside the note when the reader is wide. A page shows none of its mechanics by default; this is where \"where this comes from\" goes. An agent's call answers the same list and opens nothing in the person's reader",
    keys: [{ keys: "S", does: "open sources", says: "show where this note's generated parts come from" }, { keys: "click", does: "the header's [sources]" }],
    touches: "shape", replay: "safe", says: () => "opened the sources", way: "the inspector opens beside their note · an agent reads the list in the answer, or sources.at line=",
    menu: noteRow("where this comes from (sources)", "S", { now: ({ surface }) => (!surface.msg || !isOutlineNote(surface.msg) || surface.msg.partial ? { hide: true } : null) }),
    args: {},
    run: (_, { surface, host, standing }, actor) => surface.openSources(host, actor, standing),
  }),
  "sources.at": def({
    summary: "open the Sources inspector on the generated region that holds a line: line= (from 1), else the person's selection, `[ ]` position or reading line. The passage toolbar's \"Where from\" (a then w) is this. An agent's call answers that source's row and opens nothing in their reader",
    keys: [{ keys: "a then w", does: "with words selected in a generated region" }, { keys: "click", does: "[Where from]" }],
    touches: "shape", replay: "safe", way: "the inspector opens beside their note · an agent reads the source in the answer",
    args: { line: { type: "number", optional: true, about: "the note line, from 1 (default: the selection's, else the [ ] position's, else the reading line)" } },
    examples: [
      { act: "sources.at line=14", does: "opens the Sources inspector on the generated region that holds line 14" },
    ],
    run({ line }, { surface, host, standing }, actor) {
      const at = line !== undefined ? { line: line - 1 } : standing ? surface.regionHere() : null;
      if (!at || ("line" in at && at.line < 0)) throw new ActionRefused("say which line: line=<from 1>, or select words (or put [ ] on a line) in a generated region first");
      return surface.openSources(host, actor, standing, at);
    },
  }),
  "sources.field": def({
    summary: "type in the inspector's property field, select a schema choice, save or cancel it", keys: modeActionKeys(ATTACHED_KEYS, "sources.field"),
    touches: "draft", draft: "write", replay: "ask", person: "the field is the person's; an agent passes value= to sources.set",
    args: { op: { type: "string", about: "text, key, pick, toggle, save or cancel" }, value: { type: "string", optional: true, about: "typed text or key name" }, n: { type: "number", optional: true, about: "choice from zero" } },
    examples: [{ act: "sources.field op=save", does: "writes the field through draft.patch" }],
    run: async ({ op, value, n }, { surface, host }) => { await surface.sourcesMode?.view.input(op, value, n); host.redraw(); return { edited: true }; },
  }),
  "sources.select": def({
    summary: "select text in the inspector without selecting the reader behind it", keys: "a drag in the panel",
    touches: "shape", replay: "safe", person: "the inspector selection belongs to the person",
    args: { phase: { type: "string", about: "start or drag" }, row: { type: "number", about: "content row from zero" }, col: { type: "number", about: "column from zero" } },
    examples: [{ act: "sources.select phase=start row=2 col=0", does: "starts selecting panel text" }],
    run: ({ phase, row, col }, { surface, host }) => {
      const mode = surface.sourcesMode;
      if (!mode) throw new ActionRefused("S opens the Sources inspector");
      surface.focusSources(host, true);
      if (phase === "start") mode.view.begin({ row, col }); else mode.view.extend({ row, col });
      host.redraw();
      return { text: mode.view.text() };
    },
  }),
  "sources.focus": def({
    summary: "give the keys to the Sources inspector or back to the reader, keeping the panel open", keys: "S in the reader, a click in the panel or its footer",
    touches: "shape", replay: "safe", person: "the inspector is the person's view; an agent reads sources.open",
    args: { on: { type: "boolean", about: "true gives keys to sources; false returns them to the reader" } },
    examples: [{ act: "sources.focus on=false", does: "returns keys to the reader" }],
    run: ({ on }, { surface, host }) => surface.focusSources(host, on),
  }),
  "sources.close": def({
    summary: "close the Sources inspector", keys: modeActionKeys(ATTACHED_KEYS, "sources.close"), touches: "shape", replay: "safe", says: () => "closed the sources", confirms: true, person: "the inspector is the person's view; an agent reads sources.open",
    args: {}, run: (_, { surface, host }) => surface.closeSources(host),
  }),
  "sources.back": def({
    summary: "from one source back to the list; from the list, close the inspector", keys: modeActionKeys(ATTACHED_KEYS, "sources.back"), touches: "shape", replay: "safe", person: "the inspector is the person's view; an agent reads sources.open",
    args: {}, run: (_, { surface, host }) => surface.backSource(host),
  }),
  "sources.pick": def({
    summary: "move in the inspector: the next or previous source in the list (by=), or the nth (n=); inside one source, its next row (a fold, a parameter, a copy)", keys: modeActionKeys(ATTACHED_KEYS, "sources.pick"),
    touches: "shape", replay: "safe", person: "the inspector is the person's view; an agent reads sources.open",
    args: { by: { type: "number", optional: true, about: "rows to move; negative is up" }, n: { type: "number", optional: true, about: "the row, from 1" } },
    examples: [
      { act: "sources.pick by=1", does: "moves to the next source in the inspector's list" },
      { act: "sources.pick n=3", does: "moves to the third source in the list" },
    ],
    run: ({ by, n }, { surface, host }) => surface.pickSource(host, by, n),
  }),
  "sources.enter": def({
    summary: "⏎ in the inspector: open the selected source; on a row of one, fold or unfold it, edit the parameter (the person is asked), jump to the transform's note, or copy", keys: modeActionKeys(ATTACHED_KEYS, "sources.enter"),
    touches: "draft", replay: "ask", draft: "write", person: "the inspector is the person's view; an agent reads sources.open and writes with sources.set source= param= value=",
    args: { n: { type: "number", optional: true, about: "the row, from 1 (default: the selected one)" }, fresh: { type: "boolean", optional: true, about: "open a result beside the reader" } },
    examples: [
      { act: "sources.enter n=2", does: "does what enter does on row 2 of the inspector, such as opening that source" },
    ],
    run: ({ n, fresh }, { surface, host }, actor) => surface.enterSource(host, actor, n, fresh),
  }),
  "sources.item": def({
    summary: "a click on a row of an open source: it is the focused row, and does what ⏎ does there", keys: "a click on a row", touches: "draft", replay: "ask", draft: "write", person: "the inspector is the person's view; an agent reads sources.open and writes with sources.set source= param= value=",
    args: { n: { type: "number", about: "the row, from 1" } },
    examples: [
      { act: "sources.item n=2", does: "focuses row 2 of the open source and does what enter does there" },
    ],
    run: ({ n }, { surface, host }, actor) => surface.enterSource(host, actor, n),
  }),
  "sources.fold": def({
    summary: "fold or unfold one of the open source's three parts: query (its parameters), transform (the code or template that shaped it) or result (its rows)", keys: modeActionKeys(ATTACHED_KEYS, "sources.fold"),
    touches: "shape", replay: "safe", person: "the inspector is the person's view; an agent reads sources.open",
    args: { fold: { type: "string", about: `${FOLDS.join(", ")}` } },
    examples: [
      { act: "sources.fold fold=transform", does: "folds or unfolds the open source's transform part" },
      { act: "sources.fold fold=result", does: "folds or unfolds the open source's result rows" },
    ],
    run: ({ fold }, { surface, host }) => { if (!(FOLDS as readonly string[]).includes(fold)) throw new ActionRefused(`fold is ${FOLDS.join(", ")}, not ${JSON.stringify(fold)}`); return surface.foldSource(fold as SourcesFold, host); },
  }),
  "sources.refresh": def({
    summary: "read the sources again (\"Updated … ⟳\"): in the list with all=true (r), every line that runs on the note is run again first, as the person asks for it; on one source, only that line. Never run by a bare key outside the inspector",
    keys: modeActionKeys(ATTACHED_KEYS, "sources.refresh"), touches: "nothing", replay: "ask", person: "the inspector is the person's view; an agent runs lines again with projection.refresh line=",
    args: { all: { type: "boolean", optional: true, about: "run every line that runs on the note again, then read (default: from the list)" } },
    examples: [
      { act: "sources.refresh all=true", does: "runs every line that runs on the note again, then reads the sources" },
      { act: "sources.refresh", does: "runs the open source's line again and reads its rows" },
    ],
    run: ({ all }, { surface, host }, actor) => surface.refreshSources(host, actor, all === true),
  }),
  "sources.set": def({
    summary: "edit one source parameter: figure properties use the shared inspector field and draft.patch against their YAML; handler slots and ::use props use the existing line save. Schema choices and result property names supply the figure's choices; title and query take text, with query warnings after capture. An agent passes value=. Recorded as whoever asks; ctrl+z (sources.undo) takes it back",
    keys: modeActionKeys(ATTACHED_KEYS, "sources.set"), touches: "draft", draft: "write", replay: "ask",
    args: { source: { type: "string", optional: true, about: "which source: its number in sources.open's list, or its key (default: the one open in the inspector)" }, param: { type: "string", optional: true, about: "the parameter (default: the focused row's)" }, value: { type: "string", optional: true, about: "the new value (the person is asked when it is left out)" } },
    examples: [
      { act: "sources.set source=2 param=limit value=20", does: "writes 20 into the limit parameter of source 2's line in the note" },
    ],
    run: ({ source, param, value }, { surface, host }, actor) => surface.setSourceParam(source, param, value, host, actor),
  }),
  "sources.copy": def({
    summary: "copy a part of the open source: query (its line), transform (its code) or result (every row, tab separated); the person's goes to the clipboard, an agent's is returned", keys: modeActionKeys(ATTACHED_KEYS, "sources.copy"),
    touches: "nothing", replay: "safe",
    args: { part: { type: "string", optional: true, about: "query, transform or result (default: the focused copy row's, else result)" }, source: { type: "string", optional: true, about: "which source: its number in sources.open's list, or its key (default: the one open in the inspector)" } },
    examples: [
      { act: "sources.copy part=query", does: "returns the open source's query line" },
      { act: "sources.copy part=result source=2", does: "copies every row of source 2, tab separated" },
    ],
    run({ part, source }, { surface, host }, actor) {
      const P = surface.sourcesMode?.panel, s = P?.answer?.sources[P.open ?? -1];
      const at = P && s ? itemsOf(s, P.folds)[P.item] : undefined;
      const which = part ?? (at?.kind === "copy" ? at.part : "result");
      if (which !== "query" && which !== "transform" && which !== "result") throw new ActionRefused("part is query, transform or result");
      return surface.copySource(which, host, actor, source, !part);
    },
  }),
  "sources.download": def({
    summary: "save the source's raw rows as CSV or JSON; returns the file path", keys: modeActionKeys(ATTACHED_KEYS, "sources.download"),
    touches: "nothing", replay: "ask",
    args: { format: { type: "string", about: "csv or json" }, source: { type: "string", optional: true, about: "source number or key; default the open source" }, path: { type: "string", optional: true, about: "new file path; default the door's downloads folder" } },
    examples: [
      { act: "sources.download format=csv", does: "saves the open source's rows as CSV and returns the file path" },
      { act: "sources.download format=json source=2", does: "saves source 2's rows as JSON and returns the file path" },
    ],
    run({ format, source, path }, { surface, host }) {
      if (format !== "csv" && format !== "json") throw new ActionRefused("format is csv or json");
      return surface.downloadSource(format, host, source, path);
    },
  }),
  "sources.jump": def({
    summary: "jump to the open source's transform note (the script, the template): the person's reader opens it; an agent is told its id and reads it with outline_read", keys: modeActionKeys(ATTACHED_KEYS, "sources.jump"),
    touches: "tile", replay: "ask", way: "the jump leaves the page they are reading · an agent reads the note with outline_read",
    args: {}, run: (_, { surface, host, standing }, actor) => surface.jumpSource(host, actor, standing),
  }),
  "sources.scroll": def({
    summary: "scroll the Sources inspector's rows (a tall result or transform), by rows; moving the focus scrolls it into view too", keys: modeActionKeys(ATTACHED_KEYS, "sources.scroll"),
    touches: "shape", replay: "safe", person: "the inspector is the person's view; an agent reads the rows in sources.open's answer",
    args: { by: { type: "number", about: "rows; negative is up" } },
    examples: [
      { act: "sources.scroll by=8", does: "scrolls the inspector's rows down eight rows" },
      { act: "sources.scroll by=-8", does: "scrolls the inspector's rows up eight rows" },
    ],
    run: ({ by }, { surface, host }) => surface.scrollSources(host, by),
  }),
  "sources.undo": def({
    summary: "undo the last sources.set made in this reader while reading this note (an agent undoes its own, the person theirs); refused if the line changed again since",
    keys: modeActionKeys(ATTACHED_KEYS, "sources.undo"), touches: "draft", draft: "write", replay: "ask",
    args: {}, run: (_, { surface, host }, actor) => surface.undoSource(host, actor),
  }),
  "use.undo": def({
    summary: "undo the last use.fill made in this reader while reading this note (an agent undoes its own, the person theirs); refused if the ::use line changed again since",
    keys: "ctrl+z (when a ::use fill was the last change made here)",
    touches: "draft", draft: "write", replay: "ask",
    args: {},
    run: (_, { surface, host }, actor) => surface.undoUse(host, actor),
  }),
  "fields.anchor": def({
    words: "give the line an anchor other notes can link to",
    summary: "give the line a ::fields row opens an anchor, so ((note^anchor)) links to that line for good (it works on the web too); the person's copies the link, an agent's is returned. The only thing a ::fields writes, and only when asked: key= which ::fields (its key; default the only one the note draws), n= its row (from 1)",
    keys: "⏎ or a click on a ::fields row's ¶",
    touches: "draft", draft: "write", replay: "ask",
    args: {
      key: { type: "string", optional: true, about: "which ::fields: its key (default the only one the note draws)" },
      n: { type: "number", optional: true, about: "the row, from 1 (default 1)" },
    },
    examples: [
      { act: "fields.anchor n=2", does: "anchors the line of the second ::fields row and returns its link" },
      { act: "fields.anchor key=beds n=1", does: "anchors the first row of the ::fields keyed beds" },
    ],
    async run({ key, n }, { surface, host }, actor) {
      return surface.anchorField(key, n ?? 1, host, actor);
    },
  }),
  "task.menu": def({
    summary: "open a step's status choice under its box, as ⏎ or a click does (the person's; an agent uses task.status)",
    keys: "⏎ or a click (or right-click) on a step's box",
    touches: "tile", replay: "safe", person: "the status choice is the person's; an agent sets a step with task.status",
    args: STEP_ARGS,
    examples: [
      { act: "task.menu n=3", does: "opens the status choice under the third step's box" },
    ],
    async run(which, { surface, host }, actor) {
      const e = surface.stepFor(which, actor) ?? (await surface.whole(), surface.stepNamed(which));
      surface.openPicker(e);
      host.redraw();
      // The choices as the panel draws them: on a live row, each says what it writes.
      return { open: true, step: e.task!.step.itemId ?? null, choices: (surface.picker?.list.items ?? STEP_CHOICES).map(c => ({ id: c.id, key: c.key, label: c.label })) };
    },
  }),
  ...PROPOSAL_DEFS,
  // ── what's kept on this note (src/unsent.ts, src/unsent-compare.ts): the kept-draft line's controls ──
  "unsent.diff": def({
    summary: "an edit kept on this note compared with the note as it is now, through the text it started from: only what the edit changed, each change marked already in the note, still new, or changed differently since (a conflict shows both versions). Without the starting text it is the two-way comparison and says so. The person's opens in a reader beside this one (read-only, with the controls); an agent gets the verdict and the diff",
    keys: "⏎ or a click on [show them] / [compare] on the kept-draft line",
    touches: "nothing", replay: "safe",
    menu: unsentRow("kept edit: compare with the note now", "edit"),
    args: UNSENT_ARGS,
    examples: [
      { act: "unsent.diff kind=edit", does: "compares the kept edit with the note now, marking each change" },
    ],
    async run({ kind }, { surface, host, standing }, actor) {
      const { of, u, now } = await unsentHere(surface, host, kind ?? "edit", true);
      const base = await baseTextOf(u, of, now!, host.ctx.board);
      const view = diffNote(now!, u, base);
      const verdict = compareDraft(base, u.text, now!.text);
      if (!standing) return { of, base: u.base, revision: now!.revision ?? null, at: u.at, basis: verdict.basis, verdict: verdict.kind, said: verdictWords(verdict, dayOf(u.at)), hunks: verdict.hunks.map(h => ({ line: h.start + 1, state: h.state, removed: h.removed, added: h.added, now: h.now })), diff: view.text };
      host.navigate(view, { fresh: true });
      return { of, base: u.base, revision: now!.revision ?? null, verdict: verdict.kind, opened: view.id };
    },
  }),
  "unsent.copy": def({
    summary: "the text kept on this note (kind=edit, comment, child or card), as it was written: the person's opens in a reader beside this one (read-only); an agent gets the text and where its copy is on disk",
    keys: "⏎ or a click on [open copy] on the kept-draft line",
    touches: "nothing", replay: "safe",
    menu: unsentRow("kept edit: open its copy"),
    args: UNSENT_ARGS,
    examples: [
      { act: "unsent.copy kind=comment", does: "shows the comment kept unsent on this note, as it was written" },
      { act: "unsent.copy", does: "shows the first text kept on this note (edit, comment, child or card)" },
    ],
    async run({ kind }, { surface, host, standing }, actor) {
      const k = kind ?? firstUnsent(surface) ?? "edit";
      const { of, u, now } = await unsentHere(surface, host, k, false);
      if (!standing) return { of, kind: k, text: u.text, copy: u.copy, at: u.at };
      const base = k === "edit" && now ? await baseTextOf(u, of, now, host.ctx.board) : undefined;
      const view = copyNote(now ?? ({ id: of, text: "", parentId: null, childIds: [], createdAt: u.at, updatedAt: u.at, author: "unsent", properties: [] } as Msg), u, base);
      host.navigate(view, { fresh: true });
      return { of, opened: view.id, copy: u.copy };
    },
  }),
  "unsent.dismiss": def({
    summary: "let go of what's kept on this note (kind=edit, comment, child or card): its line goes; a copy of the text stays on disk (drafts/), written first if there isn't one. The person's only",
    keys: "⏎ or a click on [let it go] on the kept-draft line or in its comparison",
    touches: "nothing", replay: "ask",
    person: "the kept text is the person's to keep or let go; an agent reads it with unsent.diff or unsent.copy",
    menu: unsentRow("kept edit: let it go (its copy stays)"),
    args: UNSENT_ARGS,
    examples: [
      { act: "unsent.dismiss kind=edit", does: "lets go of the kept edit; a copy of its text stays on disk" },
    ],
    async run({ kind }, { surface, host }) {
      const k = kind ?? firstUnsent(surface) ?? "edit";
      const { of, u } = await unsentHere(surface, host, k, false);
      const copy = copyOf(u, of.slice(0, 8));
      unshelveIf(u);
      host.ctx.flash(`let go of the ${k === "child" ? "note" : k} · its copy stays at ${tidy(copy)}`);
      host.redraw();
      return { of, kind: k, dismissed: true, copy };
    },
  }),
  "unsent.add": def({
    summary: "add what a kept edit has that the note doesn't: open this note's edit on the revision it's at now with the edit's still-new lines in it, as one draft.patch (one ctrl+z takes it back); lines already in the note aren't added again, and a line changed differently since is left as it is now and said, never overwritten. An edit written on the revision the note is at comes back whole. Nothing is saved until ctrl+s. The person's only: it opens an edit with their keys",
    keys: "⏎ or a click on [add them] on the kept-draft line or in its comparison",
    touches: "draft", draft: "write", replay: "ask",
    person: "adding a kept edit opens an edit with the person's keys; an agent proposes text with draft.patch",
    menu: unsentRow("kept edit: add its new lines into an edit", "edit"),
    args: UNSENT_ARGS,
    examples: [
      { act: "unsent.add", does: "opens an edit with the kept edit's still-new lines in it; ctrl+s saves" },
    ],
    async run(_, { surface, host }) {
      const { of, u, now } = await unsentHere(surface, host, "edit", true);
      // In the comparison view: this reader shows the note itself again, to edit it.
      if (surface.msg?.id !== of) surface.show(now!, host);
      if (surface.draft) throw new ActionRefused("this reader is already editing the note; save or close that edit first");
      if (u.base === now!.revision) {
        await surface.ensureDraft(host);                       // brought back whole (DraftSession.restore)
        host.redraw();
        return { of, added: "whole", base: u.base };
      }
      const base = await baseTextOf(u, of, now!, host.ctx.board);
      if (base === null) throw new ActionRefused(`this edit's starting text isn't kept (the note's history doesn't reach revision ${u.base}), so its new lines can't be told from what changed since · [compare] shows it against the note now, [open copy] has it whole${u.copy ? ` (${tidy(u.copy)})` : ""}`);
      const verdict = compareDraft(base, u.text, now!.text);
      const fresh = hunksOf(verdict, "new"), clash = hunksOf(verdict, "conflict");
      if (!fresh.length) throw new ActionRefused(clash.length ? "none of its lines can be added: each was changed differently since · [compare] shows both versions" : "the note already has everything in it");
      const s = await surface.ensureDraft(host);
      s.draft.straysClose = false;                               // added on purpose: never "stray" on the next esc
      const a = s.draft.applyPatch({ patchId: `unsent-${u.at}`, patches: fresh.map(h => h.span!), revision: s.draft.base, force: true }, USER);
      if (!a.applied) throw new ActionRefused(`couldn't add them: ${a.reason}`);
      const lines = linesOf(verdict, "new"), left = linesOf(verdict, "conflict");
      if (!left) { copyOf(u, of.slice(0, 8)); unshelveIf(u); }
      s.draft.note = `added ${lines} line${lines === 1 ? "" : "s"} from your edit ${dayOf(u.at) === "today" ? "today" : `of ${dayOf(u.at)}`}, lit · ctrl+s saves · ctrl+z takes them back${left ? ` · ${left} line${left === 1 ? " was" : "s were"} changed differently since and stay${left === 1 ? "s" : ""} kept ([compare] shows both)` : ""}`;
      host.redraw();
      return { of, added: left ? "partly" : "all", lines, left, base: u.base, revision: s.draft.base };
    },
  }),
  "unsent.keep": def({
    summary: "keep a kept edit as a note of its own: a new note under this one holding the edit's whole text; the edit's line goes (a copy stays on disk). The person's only",
    keys: "⏎ or a click on [keep as a note] on the kept-draft line or in its comparison",
    touches: "nothing", replay: "ask",
    person: "the kept text is the person's to keep or let go; an agent writes notes with note.create",
    menu: unsentRow("kept edit: keep it as a note under this one", "edit"),
    args: UNSENT_ARGS,
    examples: [
      { act: "unsent.keep", does: "keeps the kept edit as a new note under this one; its copy stays on disk" },
    ],
    async run(_, { surface, host }) {
      const { of, u, now } = await unsentHere(surface, host, "edit", true);
      const copy = copyOf(u, of.slice(0, 8));
      const made = await host.ctx.board.createBlock(of, `Edit from ${dayOf(u.at)} on “${subject(now!)}”, kept\n\n${u.text}`, USER);
      unshelveIf(u);
      host.ctx.flash(`kept as a note under this one · its copy stays at ${tidy(copy)}`);
      host.redraw();
      return { of, kept: made.id, copy };
    },
  }),
  "unsent.show": def({
    summary: "unfold the old edits (kept on an older revision more than a few days ago), folded into one dim chip on this note",
    keys: "⏎ or a click on [show] on the \"1 old edit\" chip",
    touches: "nothing", replay: "safe",
    args: UNSENT_ARGS,
    examples: [
      { act: "unsent.show", does: "unfolds the old edits folded into one dim chip on this note" },
    ],
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
