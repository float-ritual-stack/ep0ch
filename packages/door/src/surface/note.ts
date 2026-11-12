// The note surface: one note, shown, edited and commented on the same way wherever it is hosted — the
// board's preview, details and floats, the desk's reader, and (next) a river column. It owns the note's
// rendering, links, the edit control (a Draft, with Ctrl+E handing it to $EDITOR), passage selection
// and comment threads, the property warning, "changed elsewhere", and keeping unsaved text safe.
//
// A host gives it a rectangle of any width and a SurfaceHost (the door's context, a redraw, and where
// a followed link opens). Everything a person can do here is also a named action (NOTE_ACTIONS), so an
// agent driving the door through its control socket goes through the same code as the keys.

import { tabStrip, stripControls } from "./chip-rows";
import { panelMode } from "./panel-mode";
import { historyRow, historyAction, trailRows, trailLine, type TrailDir, type TrailStop, type Trail, type TrailRow, HISTORY, NAV_VERSION, savedPlace, placeOf, readNav, type Place, type Zoom, type FigureChoice, type SavedNav } from "./navigation";
export { isTrailKey, historyKey, historyRow, historyAction, trailRows, trailLine, type TrailDir, type TrailStop, type Trail, type TrailRow, TRAIL_CHIP, HISTORY, NAV_VERSION, navNote, type SavedPlace, type SavedNav, type Zoom } from "./navigation";
import { collectionHint, listBinding } from "./list-keys";
import { listMode, collectionBinding, collectionKey, type ListMode } from "./list-mode";
import { drawingCaption, drawingControls, drawnImagesOf, headerRef, heroLinkSpans, imageControlLabel, imageRefTo, NotePictures, bandBesidePicture, pictureEdits, pictureRows, pictureRowsOf, pictureSourceOf, placePictures, stepOf, type DrawnImage } from "./picture-rows";
import { READER_ESC, asHintEsc, escNext, escPress } from "../esc-rule";
import { passageMenuMode, quietMode, readerEscSteps } from "./reader-esc";
import { READER_KEYS, READER_SAYS, RESOLVE_KEYS, ZOOM_KEYS, STEP_KEYS, ELEMENT_STEP_KEYS, SECTION_KEYS, READING_KEYS, nextElementKey, readerBinding, readerKeys, runAgainKey, type ReaderGuard, type ReaderKey } from "./reader-keys";
import { listAtCursor, loneCollection, rowContainerAt, rowContainerOn, type RowWorld } from "./row-container";
import { renderPrimitiveList } from "./list-drawing";
import { renderCollection } from "../collections";
import { expandsEmbeds } from "../embed-policy";
import { standsAsPerson } from "./dispatch";
import { SOURCES_KEYS, SOURCE_KEYS, SOURCE_FIELD_KEYS, REPLIES_KEYS, REPLIES_FOLD_KEYS, REPLIES_CONTROLS, REVISION_KEYS, REVISION_CONTROLS, COMMENT_KEYS, commentKeys, EDIT_PREVIEW_KEYS, EDIT_PREVIEW_READER_KEYS, NOTE_EDIT_KEYS, hintOf, rk, chooseKeys, PLACEMENT_KEYS, FIELD_KEYS, CHILDREN_KEYS, replyHint, figureKeys, LET_GO_KEYS, gripKeys, backKeys } from "./attached-keys";
import { modeBinding, modeHint, PRECEDENCE, type ModeName } from "./modes";
import { fullPlainText, selectFullText } from "../overflow";
import { pressing } from "./button";
import { figurePropertyPatch } from "@ep0ch/outline-core/figure-patch";
import { figureActions, FIGURE_SIZE_KEYS } from "./figure-actions";
import { FigureSizing, wideFigureAt } from "./figure-sizing";
import { checkValue as schemaCheck } from "@ep0ch/outline-core/component-schema";
import { Inspector } from "./inspector";
import { coerceActionArgs } from "./actions";
import { errorDetails } from "../status-log";
import { messageContext } from "../status-log";
import { Canvas, inRect } from "../canvas";
import { heroLook } from "./hero-look";
import { withFigureBoard } from "../graphs";
import { outlineBoards, readNote } from "../desk/outline-boards";
import { subtitleOf } from "@ep0ch/outline-core/block-record";
import { HEADER_VALUES } from "@ep0ch/outline-core/component-schemas-blocks";
import { InlineList, inlineRowKey } from "./inline-list";
import { LISTVIEW_ACTIONS, listNamed, type ListHost } from "./list-actions";
import { ListView, PERSON, selectable, type ListHandle, type ListViewRow } from "./list-view";
import type { ListPrimitive } from "@ep0ch/outline-core/list-row";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { outlineState } from "../state";
import { sourceDownload } from "@ep0ch/outline-core/sources";
import { ReaderPosition, PositionRows } from "../reader-position";
import { NoteForm, FORM_KEYS } from "./note-form";
import { elementEdit, ELEMENT_KEYS } from "./element-editor";
import { savedReferenceWarning } from "../reference-warnings";
import { componentBlocks } from "@ep0ch/outline-core/component-block";
import { componentRowFields, listFieldsTuned, listTarget, lookFor, pageOf as lookPage, type Look } from "../look";
import { fencedLines, HEADING_LINE, LIST_ITEM, listLayers, listStart, type StyleLayer } from "@ep0ch/outline-core/style-cascade";
import { onlyScrolled, overscrollRows, pageRows, scrolled, wheelRows } from "../scroll";
import type { Ctx } from "../app";
import { headedTitle, subject, titleLine, type Msg } from "../board";
import { Again } from "../arm";
import { codeFenceLines } from "@ep0ch/outline-core/code-fence";
import { ownPropertyRecords, parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { shellLines } from "@ep0ch/outline-core/shell-line";
import { syntaxWarnings } from "@ep0ch/outline-core/syntax-warnings";
import { propertyTokensInLine, splitPropertyValue } from "@ep0ch/outline-core/property-grammar";
import { referencedBlock, withoutFragmentAnchor } from "@ep0ch/outline-core/link-syntax";
import { landingLine } from "@ep0ch/outline-core/block-insert";
import { lineAtOffset, lineStart } from "@ep0ch/outline-core/code-ranges";
import { CommentSession, type CommentEnv } from "../comment";
import type { Step } from "../session/restore";
import { codeSpans, compareFoldPosition, foldPoints, type Doc, type DocBlock, type DocEnv, type DocImage, type FoldPoint, inertButton } from "../doc";
import { type Density, type FigureControl, type FigureInfo } from "../graphs";
import { embedsLoading, embedState, embedStepChanged, isOpenProposal, proposalsBeside, proposalApplies, proposalControls, proposalOps, SHADE } from "../embeds";
import { findOutputRegions } from "@ep0ch/outline-core/output-region";
import { sourceCalls, withSlotProps, type SourceEntry } from "@ep0ch/outline-core/sources";
import { withSchemaParams, drawSources, itemsOf, newPanel, sourceAt, type PanelDraw, type SourcesFold, type SourcesPanel } from "./sources";
import { joinRows, REGION_MARK, type RegionBook } from "../output-region";
import { decorationsOf, extensionRegion, mayHaveProjections, projectionRegion, linesThatRun, projectionsLoaded, projectionsOf, regionsByLine, resourceChanged, RUN_AGAIN, ticketBlocksOf, ticketRegion, type ResourceProjection } from "../projection";
import { decorationRows, planDecorations } from "../decorations";
import { EXT_ACTIONS, EXT_UNDO, extensionNamed, handlerKeyAction, PRESSED_VIA } from "../extensions";
import { printable, setUserSummaryKeys, summaryKeys, summarySegments, tokensFor, tokensOf, type Source, prop, propValues } from "../props";
import { type CalloutRef, type ImageRef, presentLinks, softLinkIgnoreOf, commentNotes, commentSubject, resourceTokensOf, siteAnswerOf, siteAnswerWaiting, workIdPrefix, shortId, listOpenTarget, type LinkTarget } from "../refs";
import { EMPTY_VALUE, MAX_NOTE_VALUES, hasWords, pairValues, problemWords, readerWords, valueWords } from "@ep0ch/outline-core/site-values";
import { workIdTitle } from "@ep0ch/outline-core/work-id-title";
import { alignComments, isOutlineNote, onTheirWords, openResource, RESOURCE_NOTE, rereadResource, resourceRefTarget, resourceTarget, UNSENT_NOTE } from "../authored";
import { isResourceRef } from "@ep0ch/outline-core/resource-ref";
import { changeOf, STEP_BOXES, STEP_CHOICES, STEP_MARKS, stepChanged, stepsLoading, stepTitle, statusWord, partyOf, type StepChoice, type StepRef } from "../steps";
import { stepClosed } from "@ep0ch/outline-core/checklist-marks";
import { addressedResource, destinationOf, external, externalOpenCommand, fileOpenCommand, opensRemotely, openRemote } from "../open";
import { Draft, DRAFT_ACTIONS, DRAFT_KEYS, draftChordRows, sameParty, tidy, type AnswerPlace } from "../edit";
import { agentRefusal, blockTarget, followHistory, noteReplyTarget, recordAs, DraftSession, hasStrays, leaveSaid, propertyChange, propertyListOf, unsent, type Ended, type LeaveResult, type Unsent } from "../draft-session";
import { pageWithResults } from "../page-results";
import { baseTextOf, keptName, oldUnsentLine, settleQuietly, unsentEntries, unsentLabel, unsentView, viewVerdict, type UnsentEntry, type UnsentOp } from "../unsent";
import { verdictWords } from "../unsent-compare";
import { inWindow, type Placement } from "../kitty";
import { theme, type Rgb } from "../theme";
import { fileName, heroBox, heroBoxGrown, locatePicture, type Picture, HERO_PROP_NAMES, heroPropText, media, type HeroProp, parseImageLine, parseMediaLine, parsePictureFence, sized, type Focus, type ImagePrimitive, type MediaAttr, type MediaSpec } from "../media";
import { artifactFacts } from "../artifacts";
import { backdrop, heroHeaderMode, heroHeaderOn, heroStep, HERO_RAMP_ROWS, HERO_STEPS, overColours, type CellGrid, type HeroMode } from "./hero-header";
import { TONE_INDEX, surfaceMix } from "../theme";
import type { Scroll } from "../canvas";
import type { PropertyRecord } from "@ep0ch/outline-core/property-parse";
import { authorName, whoOf, changedSinceRead, EditConflict, mutationFor, Offline, recorded, recordedAnswer, Refused, USER, type Actor, type ChecklistStep, type Comment, type CommentPassage, type OutlineEvent, type PropertyPatch, type QuotePlace, type QuoteReceipt, type QuoteSubject, type RecordedAs, requesterOf } from "../socket";
import { lastTrashed } from "../note-trash";
import { copyLineRef, deliverNoteRef, lineRef, noteCopyText, type NoteRefKind } from "../note-ref";
import { markReveal, revealOn } from "../reveal";
import { drawRevision, openingRow, revisionFacts, type RevisionAgainst, type RevisionView, compareAt } from "./revision-compare";
import { liveMarkValue, liveRowStatus } from "@ep0ch/outline-core/figure-live";
import { fieldsBlocksOf } from "@ep0ch/outline-core/site-blocks";
import { fieldsDrawn, type FieldsDrawing } from "../site-blocks";
import { visible, tailFrom, BOLD, bgRgb, fgRgb, ellipsize, drawEllipsized, dim, C, extractLinks, fg, LINK_END, linkTag, pad, RESET, stripMarks, stripTags, width, type LinkRange } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { bbsDate, rowLines, rule, waitingText, wrap } from "../text";
import { startShare, endsIn } from "../share-cli";
import type { ShareSession } from "@ep0ch/outline-core/protocol";
import { startsTable, tableCells } from "@ep0ch/outline-core/table-shape";
import { blockdownHooks, drawIn, embedOnly, linkSink, NO_READER, readableSource, sequenceStart, tagInto } from "./blockdown-context";
export { embedOnly, readableSource } from "./blockdown-context";
import { bodyTargets, copyControls, foldHeadTargets, pickTarget, pickTargets, type RowGeometry } from "./note-targets";
export { COPY_ROWS, pickTarget } from "./note-targets";
import { ActionRefused, actionSet, def, keyCaption, agentLabel, agentWords, asActor, type ActionSet, type ArgsOf, type ArgsOfSet } from "./actions";
import { Dispatcher } from "./dispatch";
import { holdsEdit, NOBODY } from "../whereabouts";
import { editHint, editState, saidRows, editorClick, foldTwice, selectClicks, openInEditor, renderEditor, previewRows, wheelTarget, writtenBy, type EditFrame } from "./editor";
import { composerBody, composerBox, placeBox, type ComposerBox } from "./composer";
import { attachedRect, drawAttachedFloat, type AttachedSide, type AttachedPlace, type FloatMove, moveFloat, frameZone, SPLIT_MIN_H, SPLIT_MIN_W, type FloatRect } from "./attached";
import { Attachments, type AttachedState, type AttachmentDef, type AttachmentKind } from "./attachments";
import { pickerCwd, pickInto, type Picked } from "../pick";
import { sourceSpanOf } from "./source-map";
import { passageActions, scriptsAt, scriptActions, installWords, threadAgents } from "../extensions";
import { actRequestOf, lineWords } from "@ep0ch/outline-core/action-line";
import { INVITES, type Press } from "./invite";
import { buttonCallAt, buttonCallsOf, buttonPressed, slotArgs, withButtonSlot, type ButtonCall } from "@ep0ch/outline-core/button-call";
import type { ComponentSchema } from "@ep0ch/outline-core/component-schema";
import type { SettingField } from "./settings-card";
import { settingsSubject, settingsKey, SETTINGS_DEFS } from "./settings";
import { askInBar } from "../bar/ask";
import { argQuestion } from "../bar/form";
import type { ActionInfo } from "./actions";
import { parseTileAddress } from "../desk/tile-address";
import { buttonIn, buttonLineLook, buttonMarks, describeButtonMarks, slotButton, type ButtonLookups } from "../button-check";
import { propQuestion } from "../template-stamp";
import { useCallsOf, withUseProps } from "@ep0ch/outline-core/template-use";
import type { LiveSite } from "../live";
import { AskAgain, heardBy, outlineChanged } from "../search-schedule";
import { SocketBoard } from "../socket";
import { CALLOUT_HISTORY, IMAGE_HISTORY, newestUndo, NOTHING_TO_UNDO, SOURCE_HISTORY, STEP_HISTORY, USE_HISTORY, type LineEdit, type LineUndo } from "./note-undo";
import { undoneSaid, type UndoHistory } from "../undo-journal";
import { hasCard, kindOf, wholeNoteMarks, MARGIN_MODE_WORDS, MARGIN_RESERVE, marginColumn, placeCards, spanBg, toneBg, toolbarRow, type MarginMode, type PassageChoice } from "./margin";
import { findPassage, isMiss, missMessage, passageAt, type Passage as PassageTarget } from "@ep0ch/outline-core/passage";
import { dropActions, imagePathAt } from "../paste-image";
import { completerFor, completerOf, completionOf, draftEscCloses, actionHereAt, type Completer } from "./completer";
import { propertyRows, PropertyPanel, valueField, valueTarget, type PropRow, type ValueRow, describeRow } from "./props-panel";
import { ModeStack, type ReaderMode } from "./modes";
import { filterLine, LineField } from "./line";
import { isAnnotationBlock, readReplies, readThread, threadRows, type ThreadData, linkRows, linkRowLines, describeLinkRow, type LinkData, type LinkGroupName, type LinkRow, type LinkBlocksEnv } from "../links";
import { DEFAULT_BACKLINK_VIEW_OPTIONS } from "../backlinks";
import { MOUSE_ALT, RowPresses } from "../scroll";
import { menuRow } from "../desk/tile-menu";
import { centred, listFieldPicker, ListPicker, pickRow } from "./picker";
import { createPage, followSoft, offerPage, PAGE_OFFER_MS, type PageOffer, type PageOfferReader, type SoftChoices } from "./soft-follow";
import { calloutsOf, calloutsStamp } from "../callouts";
import { headingStylesOf, headingStylesStamp } from "../heading-styles";
import { calloutBlocks, rewriteCalloutHeader, stripQuotes } from "@ep0ch/outline-core/callouts";
import { ReaderPointer, type KeptCursor, type ReaderGesture } from "./reader-pointer";
import { AGENT_BG, selectText, cellsOf, copyOnSelect, isCopyKey, lineAt, modeKey, paintRange, ITEM_BG, ITEM_IDLE_BG, putCell, RULER_BG, RULER_IDLE_BG, readingRuler, SELECT_BG, Selection, selectionHint, THREAD_BG, wordAt, type Pos, type SelectRows } from "./selection";
import { type BylinePiece, flowByline, SHORT_READER_ROWS } from "./byline";
import { type Link, calloutBase, calloutTitle, figureElemBase, linkText, linksOf, refOfLink, sameElementLink, sameLink, taskBase } from "./link-model";
import { calloutPanel, type Choice, type Control, controlKey, type Picker, pickerPanel, rowsOfLines, type ThreadControl, threadPanel, withRows, isWholeNote } from "./note-panels";
import { armsEdit, BUTTON_TILES, movedOn, type On, SESSION_ACTIONS, type SessionKind, tileNamed, TINT_ARGS, foldLabel, REFUSED } from "./note-actions/shared";
import { PROPOSAL_DEFS } from "./note-actions/proposals";
import { FORM_DEFS } from "./note-actions/forms";
import { EDIT_DEFS, EDIT_OPEN_DEFS, EDIT_SAVE_DEFS, EDIT_STRAYS_DEFS } from "./note-actions/editing";
import { REVISION_DEFS } from "./note-actions/revisions";
import { REPLY_DEFS } from "./note-actions/replies";
import { ELEMENT_DEFS, ELEMENT_OPEN_DEFS } from "./note-actions/elements";
import { COMMENT_DEFS, THREAD_DEFS, QUOTE_DEFS } from "./note-actions/comments";
import { PLACEMENT_DEFS } from "./note-actions/placement";
import { MOVE_DEFS } from "./note-actions/move";
import { PROPS_DEFS, DECOR_DEFS } from "./note-actions/props";
import { READING_DEFS } from "./note-actions/reading";
import { SELECT_DEFS, SELECT_CLEAR_DEFS } from "./note-actions/select";
import { TASK_DEFS, TASK_UNDO_DEFS, USE_DEFS } from "./note-actions/tasks";
import { CALLOUT_DEFS } from "./note-actions/callouts";
import { IMAGE_DEFS, IMAGE_UNDO_DEFS } from "./note-actions/images";
import { SOURCES_DEFS } from "./note-actions/sources";
import { UNSENT_DEFS } from "./note-actions/unsent";
import { BUTTON_DEFS } from "./note-actions/buttons";

/**
 * How a note is being opened (PIE-441), for the host to decide where: `link`, a link the person followed (⏎ or a
 * click; the board's preview opens it in a detail, as ⏎ on a card does); `fresh`, in a new reader (alt+⏎: a new
 * detail, a new desk reader, a new river column); neither: `u`, and whatever else opens. `by` (PIE-514): the actor
 * itself, carried to where it lands, so an agent's open is an agent's there too: it never takes the person's keys.
 */
export interface OpenHow { where?: import("@ep0ch/outline-core/list-row").ListOpenWhere; link?: boolean; fresh?: boolean; by?: Actor; standing?: boolean }
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
  preview?(m: Msg, where?: OpenHow["where"]): void;
  /** The summary keys of the view this note is shown from (a lane's `[summary-properties::…]`), if any. */
  summaryKeys?(m: Msg): readonly string[] | null | undefined;
  /**
   * Start a session as the person's key does, where the host keeps track of which session the person is in: the
   * thread list (⏎ or a click on a comment mark), an armed edit confirmed (edit.arm). Without it the surface opens it itself.
   */
  startSession?(kind: SessionKind, opener?: Key): void | Promise<unknown>;
  /** A press on a comment thread's mark in a host that draws no thread cards (a river column shows it as a reply): PIE-1543. */
  showThread?(thread: string): void;
  /** The person's new note `m` made from this reader, opened in their edit where their new notes open (`note.opens`), lit as arrived. */
  writeNew?(m: Msg): Promise<{ tile: string; surface: NoteSurface } | null>;
  /**
   * The comment being written goes into a tile of its own beside this reader (`on`), or out of it (PIE-846): the host's
   * `comment` tile, which moves, sizes and docks as tiles do. Hosts with no tiles (the BBS reader, a river column) have
   * none: a comment there is drawn split.
   */
  answerTile?(ask: string, actor: Actor, fold?: string): Promise<unknown>; shownAsk?(): string | undefined; answerAt?(): AnswerPlace | undefined; current?(): SurfaceHost | undefined;   // current: this reader's host on the desk holding it after a move into a group or the drawer (PIE-1716), else none; a draft asks it each time
  /** Pointer coordinates belong to this attached tile rather than the note beneath its floats. */
  attachment?: AttachmentKind;
  hasWiredPreview?(): boolean;
  /**
   * Its attachment `kind` (the comment being written, Sources, settings, a list's children, the edit preview) in a tile
   * of its own beside it (`on`), or that tile closed (PIE-846, PIE-1536): the one hand-off every kind goes through, `keys`
   * when the tile takes the person's keys. Hosts with no tiles (the BBS reader, a river column) have none: it's split.
   */
  attachedTile?(kind: AttachmentKind, on: boolean, side?: AttachedSide, keys?: boolean): Promise<unknown>;
  /** Its `kind`'s tile is open now: false once it was closed by hand. */
  hasAttachedTile?(kind: AttachmentKind): boolean;
  /** Its trail (PIE-208) in a tile of its own beside it (PIE-1425), where the screen has tiles; null when the layout can't place one. */
  trailTile?(): Promise<unknown>;
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
  retirePeeks?(by: Actor): void;
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
  /** The reader's tile's id on its screen: its own dispatcher (`alone`) names it, so a step it runs records its tile (PIE-1718). */ tileId?(): string | undefined;
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
  /** The place in the undo order of the newest change on any of the person's layouts here (the screen, the drawer, a group): what `layout.undo anywhere=true` takes back. */
  layoutNewestSeq?(): number | undefined;
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
  beneath?: true;   // its stops lie beneath the reader's own (PIE-1516: the list it opened in place over), listed and walked after them
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
} as const satisfies Record<import("@ep0ch/outline-core/screen-spec").TileHeader, string>;
export type TileHeader = keyof typeof TILE_HEADERS;
export const isTileHeader = (v: unknown): v is TileHeader => typeof v === "string" && v in TILE_HEADERS;

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
  /** The summary's linked values, each on its own row (`row`; left out, `summaryRow`): a narrow byline lays its segments over more rows. */
  summaryLinks: { from: number; to: number; link: Link; key: string; row?: number }[];
  /** The title's rows (null: a host's own header stands in for it, or the note leaves it out). */
  title: { row: number; rows: number } | null;
  /** A host's own header (the BBS message header) stands in for the title, byline and crumbs. */
  own?: boolean;
  pathRow?: number;
  /** The byline's [comment] (PIE-846): a click writes a comment on the whole note, as C with nothing selected does. */
  commentChip?: { row: number; from: number; to: number };
  sourcesChip?: { row: number; from: number; to: number };
  /** The byline's comment count (PIE-873): a click cycles the margin, as M does. */
  marginChip?: { row: number; from: number; to: number };
  /** The byline's property count, `i N properties` (PIE-1685): a click opens the property panel, as `i` does. */
  propsChip?: { row: number; from: number; to: number };
  titleControls?: { row: number; from: number; to: number; link: Link }[];
  wholeMarks?: { row: number; from: number; to: number; thread: string }[];
}

/** A note drawn once (NoteSurface.digest, PIE-1543): its header and body rows, each with every press target on them. */
export interface DrawnNote {
  header: { lines: string[]; targets: Hit[] };
  lines: string[]; targets: Hit[]; placements: Placement[];
  current: number | null; key: string | null; trims: Doc["trims"]; source: number[];
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
export interface SurfaceView { wide?: { row: number; col: number; cols: number }[]; frame?: FloatRect; headerBand?: { row: number; rows: number; bg: string }; completion?: Completer; gutter?: { row: number; text: string }[]; lines: string[]; placements?: Placement[]; scroll?: Scroll }

/**
 * Where a click lands in the last render, in the surface's own cells: a link (the body's, an embed's
 * title or result, a summary value), or a row of the property panel (`follow`: its value names a target).
 * `value`: a summary-line value's property key; it follows as the panel's `o` does (followValue).
 * `copy`: the selection's copy control (PIE-419), which copies what's drawn or its source.
 * `elem`: the `[ ]` element the link is (PIE-441); `thread`: a comment mark in the margin, or a control of a thread expanded under its passage (PIE-420).
 * `history`: the history row's `← back` (-1) or `forward →` (1), PIE-453.
 * `pick`: a row of the open choice (a step's status, PIE-472; a callout's type, PIE-538), by its index.
 */
export type Hit = { row: number; from: number; to: number } & ({ link: Link; value?: string; elem?: string } | { prop: number; follow: boolean } | { copy: "visible" | "source" } | { block: number } | { thread: string; elem: string } | { history: TrailDir } | { pick: number } | { image: string } | { passage: string } | { start: SessionKind } | { margin: true } | { fold: number } | { listPreview: number } | { region: string } | { sources: true } | { zoom: number });

/** A body's hooks with the proposals beside the note drawn after their lines, after whatever else follows those lines. */
function withBeside(hooks: Partial<DocEnv>, beside: Map<number, ((width: number) => string[])[]>): Partial<DocEnv> {
  if (!beside.size) return hooks;
  const after = hooks.after;
  return { ...hooks, after: (line, width) => joinRows([after?.(line, width) ?? [], ...(beside.get(line) ?? []).map(draw => draw(width))]) };
}

/** The elements that are one row inside a container (a figure's row, a step): the reader item-focuses them (PIE-969). */
const ITEM_KINDS = new Set<ElementKind>(["row", "task"]);
/**
 * What `[ ]` stops on (PIE-441), in reading order: a link (in the text, the summary line, or an image or
 * video), a fold point (a heading or a list item with lines under it), a row that stands for a note (a live
 * figure's row, an embedded view's result), an embed (its title), a resource projection (its region, PIE-445)
 * and a comment mark (in the margin).
 */
export type ElementKind = "link" | "fold" | "row" | "embed" | "comment" | "control" | "resource" | "task" | "callout" | "figure" | "block";
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
/** The zoom control's glyph (PIE-780): a part fills the tile. */
const ZOOM_GLYPH = "⤢";
/** What ⏎ does on an element, for the hint. `open`: a fold is folded, a comment mark's thread is expanded. */
const verbOf = (e: Element, open: boolean) =>
  e.link?.ext ? extVerb(e.link.ext)
  : e.kind === "fold" ? (open ? "unfold" : "fold") : e.kind === "comment" ? (open ? "fold its card back to its [+]" : "open its card")
  : e.kind === "control" && e.link?.proposal?.op ? (e.link.proposal.op === "apply" ? "apply it anyway" : e.link.proposal.op === "resolve" ? "resolve it" : "dismiss it")
  : e.kind === "control" && e.link?.unsent ? UNSENT_VERB[e.link.unsent.op]
  : e.kind === "control" && e.link?.use ? "ask for what the ::use needs"
  : e.kind === "control" ? (e.control === "select" ? "select its passage" : e.control === "reply" ? "reply" : e.control === "edit" ? (e.value ? "edit the reply" : "edit the comment") : e.control === "card" ? "open its card" : e.control === "quote" ? "quote it into a new block" : e.control === "quoted" ? "open the block quoting it" : e.control === "tldr" ? "ask @margin for its TL;DR" : e.label.toLowerCase())
  : e.kind === "figure" ? (e.link?.figure?.row !== undefined ? figureActions["figure.row"].summary : e.link?.figure?.tab !== undefined ? "show this tab" : "change the density") : e.kind === "row" ? "open its note" : e.kind === "embed" ? "open it" : e.kind === "task" ? "status" : e.kind === "callout" ? "choose its type"
  : e.kind === "block" ? "copy it"
  : e.kind === "resource" ? (e.link?.url ? "open the ticket's page" : "say why there's nothing to open") : e.link?.resource ? "show the resource" : e.link?.value ? (e.link.value.problem ?? (e.link.at !== undefined ? "show the line it reads" : "say how it is computed")) : e.link?.media || e.link?.url ? "open" : "follow";
/** What ⏎ does on an extension's line or control (PIE-512): its action's label, or run it again. */
function extVerb(x: NonNullable<LinkTarget["ext"]>): string {
  if (x.action === RUN_AGAIN) return "run it again";
  const a = extensionNamed(x.extension)?.actions.find(y => y.name === x.action);
  return a ? a.label.toLowerCase() : x.action;
}
/** The keys an extension's line answers to while it's the current element: its actions' (the reader's own stay its own), and run again. */
function extKeys(x: NonNullable<LinkTarget["ext"]>, hostKeys: string): string {
  const own = (extensionNamed(x.extension)?.actions ?? []).filter(a => a.on === `handler:${x.handler}` && a.key && handlerKeyAction(x.extension, x.handler, a.key, hostKeys) === a);
  return [...own.map(a => `${a.key} ${a.id}`), `${runAgainKey()} again`].join(" · ");
}
/** Links, rows and embeds open a note, so alt+⏎ can open it in a new reader. */
export const opens = (e: Element) => e.kind === "link" || e.kind === "row" || e.kind === "embed";
export type FocusSpec = ArgsOf<typeof TINT_ARGS>;
/** A comment mark: the margin row it's drawn on, and the rows of the lines its quote spans. */
interface Mark { col?: number; thread: string; open: boolean; row: number; rows: [number, number]; label: string }

/** Text from elsewhere (an extension's output) without control characters, its lines and tabs kept. */
const printableBlock = (s: string) => printable(s, "", { lines: true });
/** A link drawn: its text, tagged with its place in `drawn` (what [ ], ⏎ and a click find it by). */
const tagged = tagInto;

export { leaveSaid, propertyChange, type LeaveResult };

// The reader's modes (src/surface/modes.ts), each with what it's about.
/** A note at a revision, beside how it is now (PIE-1433): the compare's view, its header's controls and where it was drawn. */
type RevisionMode = ReaderMode<SurfaceHost> & { blockId: string; view: RevisionView; want?: number; controls: { from: number; to: number; action: (typeof REVISION_CONTROLS)[number] }[]; body: number; rect: { x: number; y: number; w: number; h: number } };
/** Where a press that brought the keys back found the cursor (PIE-812). */
const putBackCursor = (k: KeptCursor) => { k.d.row = k.row; k.d.col = k.col; k.d.anchor = k.anchor; k.d.follow = k.follow; };
type ReplyLinksMode = ReaderMode<SurfaceHost> & { controls: { from: number; to: number; action: (typeof REPLIES_CONTROLS)[number] }[]; truncated: boolean; data: LinkData; selected: number; group: LinkGroupName | "thread"; thread: ThreadData; unfolded: Set<string>; presses: RowPresses; picked: boolean; top: number; rect: { x: number; y: number; w: number; h: number }; rowsAt: LinkRow[]; drawnItems: number[] };
type DraftMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { session: DraftSession; reply?: Msg; describe(): ReturnType<DraftSession["describe"]> & { writtenBy: string | null } };
type CommentMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { session: CommentSession; describe(): ReturnType<CommentSession["describe"]> };
/** Moving and sizing the floating composer by keys (ctrl+g, PIE-785): arrows or h j k l move it, shift with them sizes it. */
type GripMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { describe(): { moving: true; float: FloatRect | null } };
/** comment.move's arguments: steps, a place, a size (the reader's cells), or back to the usual place. */
type ComposerMove = FloatMove;
/** The person asked to go somewhere while a comment is unsent (PIE-785): what they asked for waits on their choice. */
interface LeaveAsk { what: string; name: keyof NoteActionArgs & string | "list.open"; args: Record<string, unknown>; elem?: string }
/** The answers to leaving an unsent comment, with their keys: the draft kept and on, back to writing, or let go. */
export type LeaveChoice = "save" | "keep" | "discard";
/** How the power bar says each answer (src/bar/ask.ts asks it). */
const LEAVE_SAYS: Record<LeaveChoice, string> = {
  save: "save and continue (kept unsent: C and the passage bring it back)",
  keep: "keep writing",
  discard: "discard (a copy stays on disk)",
};
type PanelMode = ReturnType<typeof panelMode>;
type SourcesMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { panel: SourcesPanel; reveal: boolean; place: AttachedPlace; float: FloatRect | null; frame: FloatRect | null; room: { w: number; h: number; col?: number; row?: number }; rect: { x: number; y: number; w: number; h: number }; draw: PanelDraw | null; view: Inspector; footer: number; describe(): unknown };
type PickerMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { picker: Picker; describe(): { step?: string | null; callout?: string | null; choices?: string[]; selected: string | undefined; note: string | null } };

/** Agent actions that open an edit or a comment session on the note. */
const STARTS_SESSION = new Set(["edit", "edit.text", "passage.select", "comment.write", "comment", "threads", "reply", "comment.edit", "resolve", "thread.seen", "thread.keep", "thread.tldr"]);
const NO_COMMENT = "no comment is being written here; C on selected words (or passage.act action=comment) opens one";
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
  /** The furthest the note scrolls (keys and the wheel stop there), and the body rows shown, from its last render: PgUp PgDn and space scroll those less one (pageBy, PIE-1293). */
  private maxScroll = Infinity; private bodyRoom = 0; pageBy(dir: 1 | -1): number { return dir * pageRows(this.bodyRoom || 16); }
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
    if (first === null && !code.has(at) && HEADING_LINE.test(body[at] ?? "")) {
      for (let i = at + 1; i < body.length && (code.has(i) || !HEADING_LINE.test(body[i]!)); i++) if (!code.has(i) && LIST_ITEM.test(body[i]!) && !/^\s/.test(body[i]!)) { first = i; break; }
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
  private ancestors: Msg[] = [];
  private pathNote = "";
  private get pathLabel() { return this.pathNote || this.ancestors.map(m => subject(m)).join(" › ") || "top level"; }
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
  /** The elements the last layout drew (the reader's rows or a river column's digest), in reading order: the target index. */
  elems: Element[] = [];
  /**
   * The reading position (PIE-1556): the current element's key, the one place `[ ]`, a click and `act` put it, and what ⏎,
   * a click and element.open act on and the ruler tints (PIE-441). There is no second cursor: a link is current as its element.
   */
  private pos: { key: string | null; link: Link | null } = { key: null, link: null };
  private get cur(): string | null { return this.pos.key; }
  /** Moving the position to an element (or letting go) drops a link that was waiting to be drawn: there is one position. */
  private set cur(key: string | null) { this.pos = { key, link: null }; }
  /**
   * A link selected (`selectLink`) while the note wasn't laid out yet (shown again, not yet drawn) is the position too
   * (`pos.link`): its element becomes `cur` at the next layout, unless the position moved meanwhile.
   */
  private get pendingLink(): Link | null { return this.pos.link; }
  /** A collection row picked before its element is drawn (a page turn, a row off the viewport): the [ ] position lands on it at the next layout (PIE-1501). */
  private pendingRow: { key: string; row: string; group?: string } | null = null;
  /** The collection row the [ ] position is about to land on (pendingRow), for what asks between the pick and the layout. */
  rowWanted(): { key: string; row: string; group?: string } | null { return this.pendingRow; }
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
  /** The reveal this surface took last (`takeReveal`), so showing the note again doesn't scroll back to it. */
  private revealed: object | null = null;
  /**
   * A focus mark an agent (or the person, through `act`) set here (the door side of PIE-423), never the person's `[ ]`
   * position: a block, and in it maybe a passage, drawn with the reading ruler's tint and the one who set it named in the
   * header. Kept as what was named, and found again on each render, so a rewrap or a refresh keeps it on its text.
   */
  focusMark: { by: Actor; spec: FocusSpec; label: string; at: number; fragment?: boolean; line?: boolean; says?: string } | null = null;
  revealMark = false;
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
  /** `a` was pressed with text selected: the passage toolbar has the next key (a mode: it ends with the selection). */
  get passageMenu(): boolean { return this.modes.get("passage-menu") !== null; }
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
  /** What the button held down is doing here: one gesture, set by a press and ended by its release (src/surface/reader-pointer.ts). */
  private readonly pointer = new ReaderPointer();
  readonly figureSizing = new FigureSizing(this.pointer);
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
  get lineField(): LineField | null { return (this.listIn ? this.listViews.get(this.listIn)?.typing : null) ?? this.panel?.field?.input ?? this.panel?.card?.editing?.input ?? null; }
  /** The key of the list the person went into (`list.enter`), or null. */
  get listIn(): string | null { return (this.modes.get("list") as ListMode | null)?.list ?? null; }
  /** The thread a Reply control asked to answer: the thread list opening next starts the reply there. */
  private replyOn: string | null = null;
  /** The comment (or one of its replies) an Edit control asked to edit (PIE-763): the thread list opening next starts the edit. */
  private editOn: { thread: string; reply?: string } | null = null;
  /** The fold point selected (its key), which `f` and ⏎ fold or unfold: the current element, when it's a fold. */
  private get foldSel(): string | null { return this.cur?.startsWith("fold:") ? this.cur.slice(5) : null; }
  private set foldSel(key: string | null) {
    if (key !== null) { const e = this.elems.find(e => e.key === `fold:${key}`); if (e) this.setElem(e); else this.cur = `fold:${key}`; }
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
  readonly listPreview = { place: "split" as AttachedPlace, float: null as FloatRect | null, frame: null as FloatRect | null, rect: null as FloatRect | null, top: 0, max: 0 };
  private drawnFolds: FoldPoint[] = [];
  private foldCache: { text: string; points: FoldPoint[]; lines: number[] } | null = null;
  /** The last reading render: where the body starts, how far it's scrolled, its rows' sources and fold heads, and `heroRows`, the rows of the header image above it (PIE-532), which every row here is under. */
  drawn: { w: number; h: number; top: number; scroll: number; room: number; doc: Doc; lines: number[]; head: string[]; body: string[]; heroRows: number; roomAt: (s: number) => number; bx: number; my: number; titleRows: [number, number]; mcols: number } | null = null;
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
  /** Bring the comment being written into view at the next paint (it opened, the person typed, it moved: PIE-770). */
  private revealComposer = false; private composerDrawn = 0; private composerAsked: number | null = null;
  /** The rows of the comment's passage in the last paint, in the reader's cells (a floating box goes beside them). */
  private composerRows: [number, number] | null = null;
  /** Where the last paint put a floating or popup composer (PIE-785), in the note's cells under its header image, and the room it had. */
  private boxRect: FloatRect | null = null;
  readonly editPreview = { place: "inline" as AttachedPlace, float: null as FloatRect | null, rect: null as FloatRect | null, frame: null as FloatRect | null, room: { w: 0, h: 0 } as { w: number; h: number; col?: number; row?: number } };
  /** Everything attached to the note (PIE-1536): the comment being written, Sources, settings, a list's children, the edit preview. */
  readonly attachments: Attachments<SurfaceHost, SurfaceView> = new Attachments<SurfaceHost, SurfaceView>(this.attachmentKinds(), () => this.lastLook?.values, { note: () => this.msg?.id ?? null, render: (of, props) => this.src ? this.src.board.request("scripts.render", { of, props, deadlineMs: 15_000 }, 20_000) : Promise.reject(new Error("this reader has no outline to ask")), redraw: () => this.src?.redraw() });
  constructor() {
    // Where the previews were left (PIE-1671): read once, by the attachments layer that keeps them, never by a field of its own.
    this.listPreview.place = this.attachments.keptPlace("list-preview") ?? this.listPreview.place;
    this.editPreview.place = this.attachments.keptPlace("edit-preview") ?? this.editPreview.place;
  }
  private innerFrame?: FloatRect;
  private boxRoom: { w: number; h: number; col?: number; row?: number } | null = null;
  /** Where the person asked to go while their comment is unsent (PIE-785): a mode over the comment, waiting on their answer in the power bar. */
  private get leaving(): LeaveAsk | null { return (this.modes.get("leave-ask") as (ReaderMode<SurfaceHost> & { ask: LeaveAsk }) | null)?.ask ?? null; }
  private set leaving(ask: LeaveAsk | null) {
    this.modes.drop("leave-ask");
    const cs = this.session;
    if (ask && cs) this.modes.pushParked({ ...quietMode(this.modes, "leave-ask", "leave question", cs, () => ""), ask });
  }
  /**
   * The header image as last placed, by its line: it stands in while it's dragged, and while a changed look (a blur, a
   * tint) is being made, so the header never goes blank under its rows (PIE-1361: the "margin" left behind).
   */
  private heroPlaced: { line: number; p: Placement } | null = null;
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
    if (this.modes.get("form")?.of !== form) this.modes.push(this.formMode(form, host));   // already open, it stays: a drag's form.place isn't a mode going (PIE-1615)
    const element = this.elems.find(e => e.link?.form?.field === field); if (element) { this.setElem(element); this.reveal = true; }
    host.enterMode?.(); host.redraw();
  }
  private formMode(form: NoteForm, host: SurfaceHost): ReaderMode<SurfaceHost> {
    let saidEnded = false; return {
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
  }
  leaveForm() { this.modes.drop("form"); }
  private formHit(x: number, y: number) {
    return this.hits.find(h => "link" in h && h.link.form && h.row === y - this.heroTop && x >= h.from && x < h.to);
  }
  /**
   * What takes the reader's keys besides reading (src/surface/modes.ts): a step's status choice, the property
   * panel, the edit, the comment session, in their precedence. The fields below are views of it.
   */
  readonly modes = new ModeStack<SurfaceHost>(() => this.pointer.end());
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
  draftSession(): DraftSession | null { return this.drafting ?? this.session?.writing ?? this.listEditor.field?.session ?? this.panel?.field?.session ?? this.panel?.card?.editing?.session ?? null; }
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
    if (!s) { this.modes.drop("comment"); return; }
    this.modes.push(this.commentMode(s));
    const rv = this.revisionMode;
    if (rv && s.startedBy.kind !== "agent") this.modes.focus(rv, false);
  }
  /** The note's comment threads, for the count in the header and the marks while picking a passage. */
  comments: Comment[] | null = null;
  private commentsFor = "";
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
  set panel(p: PropertyPanel | null) { if (p) this.modes.push(panelMode(this, p, (k, host) => this.panelKey(k, host), (x, y) => { const hit = this.hitAt(x, y); return hit && "prop" in hit ? hit : null; }, host => host.attachment ? 0 : this.heroTop, row => describeRow(row, this.src, this.msg!.text))); else this.modes.drop("panel"); }
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
  private digested: { m: Msg; w: number; maxImageRows: number; doc: Doc; lines: number[]; head: string[]; inset: number } | null = null;
  /** The header's backdrop the last render drew (PIE-598): its image and note line, its step, and how it was drawn. */
  private backdropShown: { image: string; line: number; step: number; of: number; mode: HeroMode; drawn: "kitty" | "cells" | "making" | null; over?: string; focus?: Focus } | null = null;
  /** The note drawn as written, without the rules' decorations (PIE-600): `R`, decor.raw. The reader's own state. */
  raw = false;
  /** The step changes made in this reader, for Undo (ctrl+z, `task.undo`): each party undoes its own. */
  readonly stepHistory = STEP_HISTORY;
  /** The callout changes made in this reader (PIE-538), for Undo: each party undoes its own. */
  readonly calloutHistory = CALLOUT_HISTORY;
  /** Image layout changes (PIE-532) made here, for image.undo. */
  readonly imageHistory = IMAGE_HISTORY;
  /** The props a `::use` line was given here (PIE-533 S4, use.fill), for use.undo. */
  readonly useHistory = USE_HISTORY;
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
      ...(d.views.raw.preview ? [{ action: "draft.preview", args: { on: true } }] : []),
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
    // Plain: it goes into refusals, which an agent reads as text.
    return visible(d ? editHint(d, { save: "save", follow: true, reload: d.status.conflict || d.status.changedElsewhere ? "reload" : null }) : this.modes.all().find(mode => mode.editing())?.hint() ?? "");
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
    if (f >= 0) { const p = points[f]!; return `fold ${f + 1}/${points.length} ${foldLabel(p)} · ${hintOf([rk("enter", "fold.toggle", this.effectiveFolded(p) ? "unfold" : "fold"), rk("f", "fold.toggle", this.effectiveFolded(p) ? "unfold" : "fold"), rk("F", "fold", "all"), ...SECTION_KEYS.map(r => ({ ...r, label: "next" })), ...ELEMENT_STEP_KEYS])}`; }
    // The current element, named (PIE-441); one an agent's mark scrolled away is named, but ⏎ waits for it.
    const away = !this.inView() && this.drawn ? this.elems.find(x => x.key === this.cur) : undefined;
    if (away) return `[ ] ${this.elems.indexOf(away) + 1}/${this.elems.length} · ${away.kind} ${printable(away.label)} · out of view · [ ] steps on from it`;
    const e = this.inView(), i = e ? this.elems.indexOf(e) : -1;
    // A proposal's keys go first: in a narrow tile the hint is cut from the end.
    // An extension's line or control: its keys go first, as a proposal's do.
    if (e?.link?.press?.act.startsWith("reader.crumb")) return "breadcrumb: show its links";
    if (e?.link?.press) return `[ ] ${i + 1}/${this.elems.length} · press ${printable(e.label)} · ⏎ runs ${printable(e.link.press.act.replaceAll("\n", " -> "))}`;
    if (e?.link?.ext) return `[ ] ${i + 1}/${this.elems.length} · ${extKeys(e.link.ext, this.hostKeys)} · ${e.kind === "control" ? "control" : "line"} ${printable(e.label)} · ${hintOf([rk("enter", "element.open", verbOf(e, false)), ...(e.kind === "resource" ? [rk("y", "block.copy", "copy")] : [])])}`;
    // A table row's label keeps its columns' gaps: one space each here, since two spaces part a hint row's keys (hintKeys).
    if (e && e.kind !== "fold") return `[ ] ${i + 1}/${this.elems.length} · ${e.link?.proposal ? this.proposalKeys(e.link.proposal.id) : ""}${e.kind === "task" ? "step" : e.kind} ${e.link?.media ? "▣ " : ""}${printable(e.label).replace(/\s{2,}/g, " ")} · ${hintOf([rk("enter", "element.open", verbOf(e, e.kind === "comment" && this.threadShown(e.thread!))), ...(opens(e) ? [rk("alt+enter", "element.open", "new", { fresh: true })] : []), ...(e.kind === "resource" || e.kind === "block" ? [rk("y", "block.copy", "copy")] : []), ...(e.kind === "task" ? [rk("space", "task.status", "done/to do"), rk("ctrl+z", "task.undo", "undo")] : [])])}${this.listAtCursor()?.collection ? ` · ${collectionHint()}` : this.figureHint()} · ${this.zoomHint()}`;
    const b = this.buttonAtReading()?.link?.press; if (b) return `press ${printable(b.label ?? "")} · ⏎ runs ${printable(b.act.replaceAll("\n", " -> "))}`;
    return null;
  }

  /** The keys that work right now. `extra` goes before the reading keys (a host's own, like `p pin`). */
  hint(extra = ""): string {
    const context = this.contextualHint();
    if (context !== null) return context;
    // Back, and the trail (PIE-208) once there is somewhere to go either way.
    const back = backKeys(!!this.peek(-1), !!(this.peek(-1) || this.peek(1))), backPart = back ? `${back} · ` : "";
    // Zoomed into a part (PIE-780): the way back first; else W zooms (the keys from ZOOM_KEYS, the table that binds them).
    const zoom = this.zoomHint();
    if (this.zoom) return `${extra}${zoom} · ${backPart}${hintOf([...STEP_KEYS, ...ELEMENT_STEP_KEYS, READING_KEYS[0]!])}`;
    // A proposal an agent's patch left (PIE-501): A applies it anyway (unless it can't be applied), X dismisses it.
    // Else R resolves one in view (PIE-1668): the hint names it, from the row its key runs, so R never does what it doesn't say.
    const proposal = this.msg && isOpenProposal(this.msg) ? this.proposalKeys(this.msg.id) : this.resolveTarget() ? `${hintOf(RESOLVE_KEYS)} · ` : "";
    return `${extra}${proposal}${backPart}${hintOf([...STEP_KEYS, ...SECTION_KEYS, ...ELEMENT_STEP_KEYS])} · ${zoom} · ${hintOf(READING_KEYS)}`;
  }

  /** The zoom's keys (PIE-780) as the hint says them, read from ZOOM_KEYS: the way in, or while zoomed the way back. */
  private zoomHint(): string {
    const k = ZOOM_KEYS.find(k => k.key !== "click" && (k.args?.on === false) === !!this.zoom)!;
    return hintOf([{ ...k, label: this.zoom ? k.label : "zoom" }]);
  }

  // ── what the sections below keep (each field beside its own words) ───────────
  private rereading = false;
  private rereadAgain = false;
  private readonly fieldsDrawing: FieldsDrawing = new Map();
  /** Why a press of action line `act` would be refused now (the dispatcher of the host this surface last drew for), or null. */
  private refusedPress: (act: string) => string | null = () => null;
  private imageRowsMost = Infinity; // The most rows the last layout let an image take.
  private previewDraft?: { block: string; text: string; ready: boolean; timer: ReturnType<typeof setTimeout>; board?: SocketBoard; unlisten?: () => void };
  /** The compare's last ask: only its answer is drawn, and none once the compare is closed. */
  private revisionAsk: object | null = null;
  /**
   * A new note the person is about to write (`note.new`, PIE-544): its edit saves at once (it has no properties to
   * lose), and closing it still empty puts it in the trash. Kept until its edit ends.
   */
  private readonly newNotes = new Set<string>();
  private commentsAgain: AskAgain<void> | null = null; private commentsHost: SurfaceHost | null = null;   // the host the last event came through (a tile's is made per call)
  /** The generated regions the last layout drew (src/output-region.ts): what `[ ]` stops on at each one's gutter mark. */
  private regionInfo = new Map<string, { label: string; target: LinkTarget }>();
  /** Their rows in the reader's content rows (header included), for `openRegionKey`. */
  private regionSpans: { key: string; from: number; to: number }[] = [];
  private commentSelection: { selection: Selection; text: string; from: number } | null = null;
  private openedWhileOff = new Set<string>();
  /** The thread the person just opened: the next frame brings its card into view. */
  private revealThread: string | null = null;
  private revealFrom: number | null = null;
  private notePictures = new NotePictures();
  /** Where the header's links are, by row. */
  private heroHits: { row: number; from: number; to: number; link: Link }[] = [];
  /**
   * Line changes (an image's, a callout's, their undo) run one after another, so a key pressed again before the last
   * save landed builds on it, and an undo finds the change before it.
   */
  private lineTurn: Promise<unknown> = Promise.resolve();
  private readonly pageOffer = new Again<PageOffer>({ ms: PAGE_OFFER_MS });
  private menuOffset = { col: 0, row: 0 };
  private menuArea = { row: 0, col: 0, rows: 0, cols: 0 };
  readonly sourceHistory = SOURCE_HISTORY;
  /** Notes whose old edits the person unfolded ([show] on the "1 old edit" chip). */
  private oldUnsentShown = new Set<string>();
  /** The text an edit kept without its own starting text began from, read from the note's history, by edit (null: not kept; absent: being read). */
  private unsentBases = new Map<string, string | null>();
  private unsentBaseKey = (id: string, u: Unsent) => `${id}@${u.base}@${u.at}`;
  /** What was settled quietly on the note shown (an edit the note already had), said once in a dim line. */
  private settled: { id: string; copy: string; day: string } | null = null;

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
  show(m: Msg | null, host: SurfaceHost, by: Actor = USER): boolean {
    // An edit, a comment or a value being typed holds the reader on its note.
    if (this.modes.editing && m?.id !== this.msg?.id) return false;
    if (m && m.id === this.msg?.id && host.ctx.outline === this.msg.address?.outline) m.address ??= this.msg.address;
    this.use(host);
    if (m?.id !== this.msg?.id) { if (this.msg) host.retirePeeks?.(by); this.pointer.reset(); this.settled = null; this.notice = ""; this.pageOffer.clear(); this.agent = null; this.agentDraft = null; this.focusMark = null; this.picker = null; this.clearSelections(); if (this.panel) { this.panel.sel = 0; this.panel.view.reset(); this.panel.note = ""; } }
    if ((m?.id ?? null) !== this.foldsOf) { this.folded.clear(); this.foldSeen.clear(); this.previewLists.clear(); this.previewOpen.clear(); this.expanded.clear(); this.openedWhileOff.clear(); this.foldedThreads.clear(); this.figureUI.clear(); this.inlineLists.clear(); this.figuresDrawn = []; this.listViews.clear(); this.linkBlocksDrawn = []; this.modes.drop("list"); this.modes.drop("sources"); this.modes.drop("revision"); this.foldsOf = m?.id ?? null; this.drawnFolds = []; this.zoom = null; this.zoomTurn++; }
    if (!this.draft) { this.position.view = null; this.position.reading = 0; this.position.cursor = { row: 0, col: 0 }; this.positionRows.reset(); }
    this.msg = m; if (!this.draft) this.scroll = 0; this.maxScroll = Infinity; this.endScroll = Infinity; this.endWant = null; this.letGo(); this.elems = []; this.ancestors = []; this.pathNote = "…"; this.unread = "";
    this.links = m ? linksOf(m) : [];
    if (m?.id !== this.commentsFor) { this.comments = null; this.commentsFor = ""; }
    if (!m) return true;
    if (!isOutlineNote(m)) {
      this.pathNote = m.id.startsWith(RESOURCE_NOTE) ? "a Resource · not a note in the outline" : m.id.startsWith(UNSENT_NOTE) ? "an unsent draft · read here, never written" : m.id.startsWith("door:") ? "the door's own settings · kept here, not in the outline" : "a file";
      // A Resource's text takes comments (PIE-650): its threads live in the outline, so they are read for it too.
      if (m.resource) void this.loadComments(host);
      return true;
    }
    if (m.partial || shellLines(m.text).some(line => line.open)) void host.ctx.board.request("resources.projection.read", { blockId: m.id, materialize: true, opened: true }).catch(e => host.ctx.flash(String(e)));
    if (m.partial) this.readWhole(host); else this.settleUnsent(m, host);
    void this.loadComments(host);
    this.takeReveal(m, host);
    host.ctx.board.ancestors(m.id).then(a => {
      if (this.msg?.id !== m.id) return;
      this.ancestors = a; this.pathNote = ""; host.redraw();
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
    const field = this.panel?.field?.input ?? this.panel?.card?.editing?.input ?? this.writingDraft;
    return this.withPlacementMenu(field ? { ...view, completion: completerOf(field) ?? undefined } : view, w, h, "reader");
  }

  private renderOn(w: number, h: number, host?: SurfaceHost): SurfaceView {
    this.boxRect = null;
    this.listPreview.rect = null;
    this.attachments.begin();
    if (this.panel?.card && !this.panel.card.fills && this.msg && !this.settingsSchemaOf(this.msg)) this.closePanel();
    this.attachments.sync(host);
    if (this.replyLinks) return this.attachments.beside(w, h, (cols, rows, row, col) => {
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
    }, (cols, rows) => this.renderReading(cols, rows, host, null));
    // A revision compare (PIE-1433): beside the note as THREAD is (the attached surface's split), the note as it is now beside it.
    // A comment being written stays where it is on the note's side (a split one as a popup there), the keys its own
    // until a click in the compare (revisionKeys).
    const rv = this.revisionMode;
    if (rv && rv.blockId === this.msg?.id) return this.attachments.beside(w, h, (cols, rows, row, col) => {
      rv.rect = { x: col, y: row, w: cols, h: rows };
      const d = drawRevision(rv.view, cols, rows);
      rv.controls = d.controls; rv.body = d.body;
      return { lines: d.lines };
    }, (cols, rows) => this.renderReading(cols, rows, host, this.session?.place === "tile" ? null : this.composing(host)));
    // Everything else attached (PIE-1536): a split shares the reader, a float or a popup lies over it, the one holding
    // the keys on top. A floating comment is lifted out of the note and laid with them.
    const kinds = this.attachments.layered(host);
    if (!kinds.length) return this.renderComment(w, h, host);
    const writing = this.session?.place === "tile" ? null : this.composing(host);
    const lifted = writing && (writing.cs.place === "floating" || writing.cs.place === "popup") ? writing : null;
    return this.attachments.compose(kinds, w, h, host, (cols, rows) => this.renderComment(cols, rows, host, !!lifted), this.innerFrame,
      lifted ? v => this.overComposer(v, w, h, lifted, lifted.cs.place as "floating" | "popup", host?.focused !== false) : undefined);
  }

  private renderSettings(cols: number, rows: number, row: number, col: number): SurfaceView {
    const card = this.panel!.card!, m = this.msg!;
    return { lines: card.draw(this.settingFields(m, card.schemas), cols, rows, row, col, m.revision) };
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
    const title = pad(`Children · ${p.text.replace(/^\[.\]\s+/, "")}`, Math.max(0, w - width(chip))) + fg(C.lcyan) + chip + RESET;
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
      key: k => { const field = this.listEditor.key(k); if (field && field !== true) void this.runKey("list.preview.field", field, host); else host.redraw(); return true; },
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
      hint: () => `children · ${hintOf(CHILDREN_KEYS)}`, state: () => "editing children", describe: () => ({ line: a + 1, endLine: b }),
    });
    if (actor.kind === "user") host.enterMode?.();
    host.redraw(); return { editing: true, line: a + 1, endLine: b };
  }

  async listPreviewField(a: { op: string; value?: string; n?: number }, host: SurfaceHost) { await this.listEditor.input(a.op, a.value, a.n); host.redraw(); return { editing: !!this.listEditor.field }; }

  /** The note with the comment being written in it; `lift`: a floating one is left out, to be laid over everything (renderOn). */
  private renderComment(w: number, h: number, host?: SurfaceHost, lift = false): SurfaceView {
    if (this.replyParent && this.draft) return this.renderSplit(w, h, host, { d: this.draft, f: this.replyFrame(host) });
    // A comment written split (PIE-770): the reader's rect shared, the note in one part and the composer in the other.
    const writing = this.composing(host);
    // In a tile of its own (PIE-846) the comment (or the thread list) is drawn there and the note whole here; the host is
    // asked for the tile once (it opens after this frame); with no tile to be in, a comment is drawn split.
    const cs = this.session;
    if (cs?.place === "tile") return this.renderReading(w, h, host, null);
    const split = writing?.cs.place === "split" || writing?.cs.place === "tile";
    return split && w >= SPLIT_MIN_W && h >= SPLIT_MIN_H ? this.renderSplit(w, h, host, writing!) : this.renderReading(w, h, host, lift ? null : writing);
  }

  /** The note as the reader draws it (with its header image), and a floating or popup composer over it (PIE-770). */
  private renderReading(w: number, h: number, host: SurfaceHost | undefined, writing: ReturnType<NoteSurface["composing"]>): SurfaceView {
    const hero = this.heroOf(w, h, host); if (!hero) this.heroHits = [];
    this.hero = hero && { line: hero.line, full: hero.box.rows, pinned: hero.look.scroll === "pinned", over: hero.look.title === "over", max: Math.floor(h / 2), picture: hero.box.rows };
    let v = this.renderNote(w, h, host);
    const shown = this.heroTop;
    if (hero && shown) {
      const cut = this.hero?.pinned ? 0 : Math.min(this.scroll, hero.box.rows), lines = Array.from({ length: shown }, () => "");
      if (!hero.placement && hero.loading) lines[shown >> 1] = dim(pad(`  ◌ header · ${hero.name} · ${waitingText()}`, w));
      // A drag going on says what it will write (PIE-1361), on the header's bottom row.
      const dn = this.pointer.hero?.now;
      if (dn) lines[shown - 1] = fg(C.yellow) + pad(`  ${dn.height !== undefined ? `↕ ${dn.height} rows` : `✥ focus ${dn.focus!.x},${dn.focus!.y}`} · let go to write it on the hero line`, w) + RESET;
      const above = hero.placement?.row ?? 0;
      const was = this.heroPlaced?.line === hero.line ? this.heroPlaced.p : null;
      const held = (this.pointer.hero?.now || (!hero.placement && !hero.loading && !cut)) && was;
      const p = held ? { ...held, rows: Math.max(1, Math.min(h, hero.box.rows) - cut - held.row) } : hero.placement && inWindow(hero.placement, cut + above, Math.min(h, hero.box.rows - cut) - above, above);
      if (!held && p && !cut) this.heroPlaced = { line: hero.line, p };
      // Its SVG's links (PIE-1555): presses over the header's rows (a click), and elements ([ ], ⏎) on its first row under it.
      this.heroHits = hero.placement ? heroLinkSpans(this.heroRef(this.msg!)?.path ?? "", { ...hero.box, col: hero.placement.col }, above, cut).filter(r => r.row < shown) : [];
      const own = [...new Map(this.heroHits.map(r => [r.link.page ?? r.link.block ?? r.link.url, r])).values()].map((r, i): Element => ({ key: `link:hero:${i}:${r.link.page ?? r.link.block ?? r.link.url}`, kind: "link", row: 0, from: r.from, to: r.to, ruler: [0, 1], label: `header link ${r.link.label ?? ""}`.trim(), link: r.link }));
      this.elems = [...own, ...this.elems.filter(e => !e.key.startsWith("link:hero:"))];
      v = { ...v, headerBand: v.headerBand && { ...v.headerBand, row: shown }, lines: [...lines, ...v.lines], gutter: v.gutter?.map(g => ({ ...g, row: g.row + shown })), wide: v.wide?.map(g => ({ ...g, row: g.row + shown })), placements: [...(p ? [p] : []), ...(v.placements ?? []).map(x => ({ ...x, row: x.row + shown }))] };
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
    const heroRows = this.heroTop;
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
    this.attachments.floated("comment", { ...this.boxRect, row: row + heroRows });
    const under = (p: Placement) => p.row < heroRows + row + box.lines.length + 2 && p.row + p.rows > heroRows + row && p.col < col + box.width && p.col + p.cols > col;
    return { ...v, frame: this.innerFrame, lines: this.innerFrame ? painted : [...v.lines.slice(0, heroRows), ...painted], placements: [...(v.placements ?? []).filter(p => p.row < heroRows || !focused && !under(p)), ...previewPictures(c.d, row + 1, row + 1 + box.lines.length).map(p => ({ ...p, row: p.row + heroRows }))] };
  }

  /**
   * A comment written split (PIE-770): the reader's own rect shared, the note on the left and the composer on the
   * right when the reader is wide (SPLIT_SIDE_MIN), else the note on top and the composer under it.
   */
  private renderSplit(w: number, h: number, host: SurfaceHost | undefined, c: { d: Draft; f: EditFrame }): SurfaceView {
    return this.attachments.beside(w, h, (cols, rows, row, col) => {
      const box = composerBox(c.d, c.f, cols, rows, true);
      placeBox(c.d, box, row - this.heroTop, col);
      return { lines: box.lines, placements: previewPictures(c.d, row, rows) };
    }, (cols, rows) => this.renderReading(cols, rows, host, null), this.session?.composer === c.d ? "comment" : undefined);
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
    const dragged = this.pointer.hero, now = dragged?.line === found.line ? dragged.now : undefined;
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
    const [placement] = imagePlacements([{ line: 0, media: entry, look: look.pixels, ...heroBoxGrown(entry, look, box, -(bounds?.row ?? 0), cols, cw, chh) }], 0, cw, chh);
    return { line: ref.line, box, placement: placement ? { ...placement, key: `hero:${placement.key}`, col: placement.col + (bounds?.col ?? (look.bleed === "full" ? 0 : this.bx)), row: (bounds?.row ?? 0) + placement.row } : null, loading: false, name, look };
  }

  /**
   * The reader's sticky header (its title, summary line, byline with the comment count, and crumbs; or a host's own
   * header, the BBS message header, then the summary line): the rows every reading render starts with, and the row the
   * summary is on with its links. One builder: the reading render and a digest's host (stickyHeader) both draw it.
   */
  private headerBlock(m: Msg, w: number, host: SurfaceHost | undefined, src: Source | null, short = false): HeaderBlock {
    const gx = this.printed || host?.externalGutter !== undefined ? 0 : this.gutterWidth();
    w = Math.max(1, w - gx);
    // The Work ID heads the title line (PIE-809), not this one.
    const meta = [authorName(m.author), bbsDate(m.updatedAt)].filter(Boolean).join(" · ");
    const open = this.comments?.filter(c => c.open).length ?? 0;
    // The way in to a comment on the whole note (PIE-846), by mouse: the same as C with nothing selected.
    const sourcesOn = !this.printed && this.hasSources(m);
    const commentOn = !this.printed && (isOutlineNote(m) || (m.resource && !m.resource.uncommentable));
    // Marks only (PIE-873): the margin's off mode said where the comments are counted, so it's found and its way back is.
    const n = this.comments?.length ?? 0, off = this.marginMode === "off" && !this.printed;
    // The chip says what's drawn (PIE-1255), in the mode's own words; its hover, what each mode does.
    const mode = MARGIN_MODE_WORDS[off ? "off" : this.marginMode].chip;
    const said = !this.comments?.length ? "" : `${fg(open ? C.yellow : C.dark)}■ ${n} comment${n === 1 ? "" : "s"} · ${mode} (M)`;
    // Detail's summary line: the chosen keys only; everything else is in the property panel (`i`).
    // A value that names a block, a page or a Work ID reads as a link, and a click opens it.
    const own0 = host?.header, { text: summary, line: summaryLine, links: summaryLinks, parts: summaryParts } = this.summaryView(m, src, own0 ? C.lgreen : C.dark);
    const count = this.rows(m).length;
    // A host's own header (the BBS message header) stands in for the title, byline and crumbs; the
    // summary line comes after it, so its row is counted rather than assumed.
    const own = host?.header?.(m, w, this.headerInfo(m, count));
    const propsText = !this.panel && count ? `i ${count} propert${count === 1 ? "y" : "ies"}` : "";
    if (own) {
      const summaryRows = summary ? [pad(fg(C.lgreen) + summaryLine + (propsText ? fg(C.dark) + ` · ${propsText}` : ""), w) + RESET] : [];
      // The host's header stands in for the title, so a folded whole-note thread's [+] follows its last row (PIE-1572:
      // the BBS reader had none, and "as marks" left no way to it by mouse).
      const ownRows = [...own], wholeMarks = wholeNoteMarks(ownRows, width(visible(ownRows.at(-1) ?? "").trimEnd()), 0, w, this.foldedWhole());
      // The property count, wherever the host's header drew it (the BBS reader's Stat line, or after the summary): a
      // click opens the panel, as i does (PIE-1685).
      const all = [...ownRows, ...summaryRows], propsRow = propsText ? all.findIndex(r => visible(r).includes(propsText)) : -1;
      const propsFrom = propsRow < 0 ? -1 : width(visible(all[propsRow]!).slice(0, visible(all[propsRow]!).indexOf(propsText)));
      return { rows: all.map(l => " ".repeat(gx) + l), summary, summaryRow: ownRows.length, summaryLinks: summary ? summaryLinks.map(l => ({ ...l, from: l.from + gx, to: l.to + gx })) : [], title: null, own: true, wholeMarks: wholeMarks.map(l => ({ ...l, from: l.from + gx, to: l.to + gx })),
        ...(propsRow >= 0 && !this.printed && propsFrom + width(propsText) <= w ? { propsChip: { row: propsRow, from: gx + propsFrom, to: gx + propsFrom + width(propsText) } } : {}) };
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
    const named = written ? { workId: null } : workIdTitle(subject(m, src), prop(m, "work-id")), focused = host?.focused !== false, title = written ?? headedTitle(m, src);
    // In the theme's heading colour (PIE-809): the theme caps white near the body text's grey, so a white title read as
    // body; the note's top heading is drawn as its headings are.
    const ink = (focused ? fg(C.yellow) : fgRgb(theme().palette[C.yellow]!.map(c => Math.round(c * TITLE_UNFOCUSED)) as unknown as Rgb)) + BOLD;
    const accent = fg(focused ? C.lcyan : C.cyan) + BOLD;
    // The byline (PIE-1686): whole pieces over rows (./byline.ts), never a word cut while a row has room; the rows, the
    // summary's links and every chip's cells come from the one layout.
    const pieces: BylinePiece[] = [{ text: fg(C.dark) + meta }];
    if (propsText) pieces.push({ text: fg(C.dark) + propsText, hit: "props" });
    for (const p of summary ? summaryParts : []) pieces.push({ text: p.line, links: p.links, group: "summary" });
    if (said) pieces.push({ text: said, short: `${fg(open ? C.yellow : C.dark)}■ ${n} · ${mode} (M)`, hit: "margin" });
    if (sourcesOn) pieces.push({ text: fg(C.lcyan) + SOURCES_CHIP, hit: "sources", optional: true });
    if (commentOn) pieces.push({ text: fg(C.lcyan) + COMMENT_CHIP, hit: "comment", optional: true });
    const flowed = flowByline(pieces, w, short), metaRows = flowed.rows;
    const placed = (hit: BylinePiece["hit"]) => flowed.placed.find(p => p.piece.hit === hit);
    const summaryPlaced = flowed.placed.filter(p => p.piece.group === "summary");
    const links = summaryPlaced.flatMap(p => (p.piece.links ?? []).filter(l => p.from + l.from < p.to).map(l => ({ ...l, row: p.row, from: p.from + l.from, to: Math.min(p.to, p.from + l.to) })));
    // The whole title, wrapped onto as many lines as it needs (PIE-815: a question's title is the question; cutting it
    // here was the bug). The Work ID keeps the accent at the start of the first line.
    // The tile's title-only header keeps it to one line, cut with an ellipsis.
    const lines = width(title) <= w ? [title] : omit.oneLine ? [ellipsize(title, w)] : wrap(title, w);
    const titled = lines.map((l, i) => (i === 0 && named.workId && l.startsWith(`${named.workId} · `) ? pad(`${accent}${named.workId}${fg(C.dark)} · ${ink}${l.slice(named.workId.length + 3)}`, w) : ink + pad(l, w)) + RESET);
    // A folded whole-note thread's [+] is after the title. The title-only header (PIE-1248) is one row: the whole-note
    // threads are the tile menu's comments row there.
    const wholeMarks = !this.printed && !omit.title && !omit.oneLine ? wholeNoteMarks(titled, width(lines.at(-1) ?? ""), above, w, this.foldedWhole()) : [];
    while (lines.length < titled.length) lines.push("");
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
    const path = this.ancestors, [breadcrumb] = tabStrip(path.map((note, i) => ({ label: subject(note), on: i === path.length - 1,
      hit: { action: "reader.crumb", args: { id: note.id } }, alt: { action: "reader.reveal" } })),
      { id: "breadcrumb", about: "breadcrumb: show its links · alt+click reveals this note in the outline", direct: true, width: w, overflow: "middle", style: { on: fg(C.grey), off: fg(C.dark), sep: " › " } });
    const pathText = this.zoom && !this.printed ? this.zoomBar(m, w) : isOutlineNote(m) && path.length ? breadcrumb!.text : fg(C.dark) + pad(this.pathLabel, w) + RESET;
    if (!omit.crumbs && !this.zoom && !this.printed && isOutlineNote(m)) titleControls.push(...stripControls(breadcrumb!, m.id, gx));
    const metas = metaRows.map(r => pad(r, w) + RESET);
    const rows = this.printed ? [...titled, ...subRows, ...metas, pathText] : [...(omit.crumbs ? [] : [pathText]), ...titleRows, ...(omit.byline ? [] : metas)];
    // The chip ends the first byline row (the one `said` is on), where it fits in the tile; with no byline, the tile
    // menu (⋯) has the same rows: comment on the whole note, comments, properties, sources.
    // Each chip where the byline laid it, in the tile's cells (the gutter before them); none while the byline is hidden.
    const chipAt = (hit: BylinePiece["hit"]) => { const p = !this.printed && !omit.byline ? placed(hit) : undefined; return p ? { row: first + p.row, from: gx + p.from, to: gx + p.to } : undefined; };
    const commentChip = chipAt("comment"), sourcesChip = chipAt("sources"), marginChip = chipAt("margin"), propsChip = chipAt("props");
    const summaryRow = first + (summaryPlaced[0]?.row ?? 0);
    return { rows: rows.map(l => " ".repeat(gx) + l), titleControls, wholeMarks: wholeMarks.map(l => ({ ...l, from: l.from + gx, to: l.to + gx })), summary: omit.byline ? "" : summary, summaryRow, summaryLinks: omit.byline ? [] : links.map(l => ({ ...l, row: first + l.row, from: l.from + gx, to: l.to + gx })), title: omit.title ? null : { row: this.printed ? 0 : above, rows: lines.length }, ...(this.printed ? { pathRow: rows.length - 1 } : omit.crumbs ? {} : { pathRow: 0 }), ...(commentChip ? { commentChip } : {}), ...(sourcesChip ? { sourcesChip } : {}), ...(marginChip ? { marginChip } : {}), ...(propsChip ? { propsChip } : {}) };
  }

  /**
   * Every press target of a header (headerBlock), in its rows' cells: the summary line's links, the zoom bar, the
   * byline's [comment], [sources] and comment count, a whole-note thread's [+], and the title's controls (the crumbs, a
   * rule's title decorations), which are elements too (`[ ]` reaches them). One index for every host that draws a header:
   * the reader's render and a digest's (a river column's sticky header) press the same targets (PIE-1543).
   */
  private headerTargets(m: Msg, hb: HeaderBlock, w: number, elemAt?: (row: number, from: number) => string | undefined): { hits: Hit[]; elems: Element[] } {
    const hits: Hit[] = [], elems: Element[] = [];
    if (hb.summary) for (const l of hb.summaryLinks) { const row = l.row ?? hb.summaryRow; hits.push({ row, from: l.from, to: Math.min(w, l.to), link: l.link, value: l.key, elem: elemAt?.(row, l.from) }); }
    if (hb.pathRow !== undefined && this.zoom && !this.printed) hits.push({ row: hb.pathRow, from: 0, to: w, zoom: -1 });
    if (hb.commentChip) hits.push({ ...hb.commentChip, start: "note" });
    if (hb.sourcesChip) hits.push({ ...hb.sourcesChip, sources: true });
    if (hb.marginChip) hits.push({ ...hb.marginChip, margin: true });
    // The property count (PIE-1685): the panel, as i opens it, where the host keeps track of the person's session.
    if (hb.propsChip) hits.push({ ...hb.propsChip, start: "props" });
    for (const mark of hb.wholeMarks ?? []) hits.push({ ...mark, elem: `comment:${mark.thread}` });
    for (const [i, control] of (hb.titleControls ?? []).entries()) {
      const key = `control:title:${m.id}:${i}`;
      hits.push({ ...control, elem: key });
      elems.push({ ...control, key, kind: "control", ruler: [control.row, control.row + 1], label: control.link.label ?? "run" });
    }
    return { hits, elems };
  }

  /**
   * The lines under a note's header that say what happened to it: that it's in the Trash, a save that changed its
   * properties (`notice`), what an agent did, in one set of words for every host (the reader, a river column: PIE-1543).
   */
  banner(kind: "trash" | "notice" | "agent", m: Msg, w: number): string[] {
    if (kind === "trash") return m.deleted ? [fg(C.lred) + pad(IN_TRASH, w) + RESET] : [];
    if (kind === "notice") return this.notice ? [fg(C.yellow) + pad(this.notice, w) + RESET] : [];
    return this.agent ? [fg(C.lmagenta) + pad(`an agent (${agentWords(this.agent.id)}) ${this.agent.did}`, w) + RESET] : [];
  }

  /**
   * The digest's header (digest: the reader's header rows and their targets) with its backdrop (PIE-598) for `under`,
   * how many of the digest's body rows the host has scrolled above it; `placements`: the backdrop's Kitty placements,
   * on these rows. A host that draws the digest under a scroll of its own (a river column) keeps it above the scroll.
   */
  stickyHeader(m: Msg, w: number, host: SurfaceHost, under: number, drawn: DrawnNote): { lines: string[]; placements: Placement[] } {
    const lines = [...drawn.header.lines];
    const d = this.digested?.m.id === m.id && this.digested.m.revision === m.revision ? this.digested : null;
    this.backdropShown = null;
    const shade = d ? this.heroBackdrop(m, d.doc, d.lines, w, lines.length, host, Math.max(0, under)) : { placements: [], grid: null };
    this.headerSurface(lines, lines.length, w, shade);
    return { lines, placements: shade.placements };
  }

  /**
   * The source a digest's body rows `from`..`to` (inclusive) are drawn from, for a river column's Y (PIE-1543): the
   * selected words (`seen`) as written when they are there verbatim, else the note lines those rows are drawn from
   * (a block's to the line before the next drawn one).
   */
  digestSource(drawn: DrawnNote, from: number, to: number, seen: string): string | null {
    const m = this.digested?.m, at = drawn.source.slice(Math.max(0, from), to + 1).filter(l => l >= 0);
    if (!m || !at.length) return null;
    const all = m.text.split("\n"), lo = Math.min(...at), next = drawn.source.slice(to + 1).find(l => l > Math.max(...at));
    // A fenced block's rows map to its opening fence: its source is the whole fence, closing line included.
    const fence = codeFenceLines(all);
    let hi = Math.max(Math.max(...at) + 1, next ?? Math.max(...at) + 1);
    while (hi < all.length && fence[hi - 1]! >= 0 && fence[hi] === fence[hi - 1]) hi++;
    const span = all.slice(lo, hi).join("\n");
    const words = seen.trim();
    return words && span.includes(words) ? words : span;
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
      const ref = this.imagesIn(m).find(x => x.line === this.hero!.line && x.kind !== "drawing");
      if (ref) out.push({ path: ref.path, kind: ref.spec.kind === "video" ? "video" : "img", ...look(ref.spec), line: ref.line, gone: this.hero.pinned ? 0 : clamp(scroll / Math.max(1, this.hero.full)) });
      if (mode === "first") return out;
    }
    const files = doc.media.filter(x => !x.spec.fence);
    const all = m.text.split("\n"), first = files[0];
    const firstBlock = first && noteLines[first.line] !== undefined && all.slice(1, noteLines[first.line]).every(l => !l.trim()) ? first : undefined;
    const body = mode === "follow" ? files : [files.find(x => x.spec.layout === "hero") ?? firstBlock].filter(x => x !== undefined);
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
    if (covered) return { ...covered, ...(this.draft ? { placements: this.editPreview.place === "tile" ? [] : this.draft.views.raw.frame?.preview?.placements } : {}), ...(this.draft ? { scroll: elementEdit(this.draft).on ? elementEdit(this.draft).scrollFigure : this.draft.views.raw.scrollFigure } : {}) };
    if (m.partial) return { lines: [...(host?.header ? host.header(m, w, this.headerInfo(m, 0)) : [fg(C.white) + pad(subject(m), w) + RESET]), this.unread ? fg(C.lred) + pad(`couldn't read the note: ${this.unread}`, w) + RESET : dim("reading the note…"), ...(this.unread ? [dim("it's read again when the door reconnects")] : [])] };
    this.viewKeys = host?.summaryKeys?.(m) ?? null;
    const src = this.use(host);
    // Back and forward (PIE-453): the reader's last row, while it has somewhere to go.
    const foot = this.panel?.full || h <= 3 ? null : historyRow(w, this.peek(-1), this.peek(1), !!host?.overlay);
    if (foot) h -= 1;
    // Each construct the note leaves open, on its line (PIE-669): what is read instead, and how to close it.
    const open = openConstructs(m.text);
    const hb = this.headerBlock(m, w, host, src, h <= SHORT_READER_ROWS), { rows: headerBlock, summary, summaryRow, summaryLinks, title, own, wholeMarks } = hb;
    // An agent's proposal, opened (PIE-501): its [apply] [dismiss] on a row of their own under the byline.
    const proposalTags: Link[] = [];
    const proposalHead = isOpenProposal(m) ? { row: headerBlock.length, ...extractLinks([pad(fg(C.yellow) + "proposal ·" + proposalControls(m, proposalTags) + fg(C.dark) + (" · " + this.proposalKeys(m.id).replace(/ · $/, "") + (proposalApplies(m) ? "" : " · it can't be applied: its passage was already gone")), w) + RESET]) } : null;
    const head = [
      ...headerBlock,
      ...(proposalHead ? proposalHead.lines : []),
      // A note trashed while it's shown (a proposal dismissed, a card or an ancestor trashed elsewhere: staleOn) says so: it's still readable.
      ...this.banner("trash", m, w),
      ...this.banner("notice", m, w),
    ];
    // A draft put aside on this note (esc twice, a closed screen, the door quitting) says so, with its controls:
    // [diff] [open copy] [dismiss] [take it back]; an old one on an older revision folds into one dim line.
    const unsentHead = this.unsentHead(m, w, head.length);
    head.push(...unsentHead.lines,
      // An opener without a closer (a literal region, PIE-422; a fence, `[[`, `[key::` or component, PIE-669): said.
      ...open.slice(0, OPEN_SHOWN).map(o => fg(C.yellow) + pad(`⚠ ${o.message}`, w) + RESET),
      ...(open.length > OPEN_SHOWN ? [dim(`  and ${open.length - OPEN_SHOWN} more left open`)] : []),
      ...this.banner("agent", m, w),
      // A focus mark says whose it is, in the ruler's own tint (PIE-423).
      ...(this.focusMark ? [RULER_BG + fg(C.lmagenta) + pad(this.focusMark.line ? `◆ ${this.focusMark.label} · ${this.focusMark.says ?? "the line that links here"}${this.focusMark.by.kind === "agent" ? ` · ${agentLabel(this.focusMark.by)} opened it` : ""} · ${hintOf(LET_GO_KEYS)}` : this.focusMark.fragment ? `◆ ${this.focusMark.label} · the fragment the link names${this.focusMark.by.kind === "agent" ? ` · ${agentLabel(this.focusMark.by)} followed it` : ""} · ${hintOf(LET_GO_KEYS)}` : `◆ focus · ${agentLabel(this.focusMark.by)} marked ${this.focusMark.label}`, w).split(RESET).join(RESET + RULER_BG) + RESET] : []),
    );
    if (this.panel?.card) {
      const card = this.panel.card;
      if (card.place === "inline") head.push(...this.renderSettings(w, Math.max(4, card.fills ? h - head.length : Math.floor((h - head.length) * .6)), head.length, 0).lines);
    } else if (this.panel) {
      const rows = this.rows(m);
      const tokens = tokensOf(m.text, src);
      const info = { origin: head.length, revision: m.revision, summary: this.summary(m).keys, source: this.summary(m).source, scopes: tokens === null ? "loading" as const : tokens.state === "ready" ? "ready" as const : "block" as const, src, text: m.text, look: this.lastLook?.values, values: this.valueRows(m, src) };
      const at = head.length;
      this.panel.origin = at;
      const panelHits = () => { for (const r of this.panel!.at) this.hits.push({ row: at + r.y, from: 0, to: w, prop: r.n, follow: false }, ...(r.target ? [{ row: at + r.y, from: r.from, to: w, prop: r.n, follow: true }] : [])); };
      if (this.panel.full) { const lines = [...head, ...this.panel.render(rows, w, Math.max(2, h - head.length), info)]; panelHits(); return { lines }; }
      const ph = Math.min(rows.length + 2 + (info.values.length ? Math.min(info.values.length, 6) + 1 : 0) + (this.panel.foot() ? 1 : 0), Math.max(4, Math.floor((h - head.length) * 0.5)));
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
    if (this.panel || (headed ? !host?.header || head.length + 1 < h : !!this.selection && !this.pointer.text?.selecting)) head.push(this.panel ? rule(w) : "");
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
    const headerHit = this.headerTargets(m, hb, w, (row, from) => this.elems.find(e => e.link && e.row === row && e.from === from)?.key);
    this.elems.push(...headerHit.elems);
    this.elems.sort((a, b) => a.row - b.row || a.from - b.from);
    if (unsentHead.elems.length) this.elems = [...this.elems, ...unsentHead.elems].sort((a, b) => a.row - b.row || a.from - b.from);
    // A collection row picked before this layout drew it (a page turn): the [ ] position lands on it now (PIE-1501).
    if (this.pendingRow) { const at = this.linkRowElement(this.pendingRow.key, this.pendingRow.row, this.pendingRow.group); if (at) { this.setElem(at.e); this.pendingRow = null; this.reveal = true; } }
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
    this.endScroll = reach(0); this.bodyRoom = roomFull;
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
    // An open choice under it (a step's status, a callout's type) comes in with it, as far as the element allows; a row, its whole item (a card, PIE-1529).
    this.lastReveal = this.reveal && !!current;
    if (this.reveal && current) bringIn([Math.min(current.row, current.item?.[0] ?? current.row), picks && this.picker?.key === current.key ? Math.max(current.row + 1, top + picks.at + picks.lines) : Math.max(current.row + 1, current.item?.[1] ?? 0)]);
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
        bringIn(b - a <= room || !writingIn ? [a, b] : [a + (box.box.frame?.row ?? 0) + writingIn.views.raw.cursorRow, a + (box.box.frame?.row ?? 0) + writingIn.views.raw.cursorRow + 1]);
      } else if (comp.passage) bringIn([top + comp.passage[0], top + comp.passage[1]]);
    }
    if (this.revealComposer && this.composerAsked !== null) this.composerAsked = this.scroll; this.revealComposer = false;
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
    this.drawn = { w, h, top: head.length, scroll: this.scroll, room, doc, lines: noteLines, head, body, heroRows, roomAt, bx: this.bx, my: this.my, titleRows: title ? [title.row, title.row + title.rows] : own ? [0, 1] : [0, 0], mcols: laid.margin.cols };
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
    this.hits.push(...headerHit.hits);
    const figureCol = (row: number) => wideFigureAt(doc, row) ? host?.heroBounds?.col ?? 0 : bx;
    // The links and pictures are the shared builder's (note-targets.ts), as a river column's digest uses it. An image's
    // caption opens it (its controls, tagged above, come first); a click on the image makes it the `[ ]` position.
    this.hits.push(...bodyTargets(doc, drawn, this.elems, {
      at: r => { const row = r - this.scroll; return row >= 0 && row < room ? top + row : null; },
      dx: figureCol, cols: r => wideFigureAt(doc, r)?.cols ?? w, bx, w, elemBx: bx, top,
      elemOf: r => keyOf.get(`${top + r.line}:${r.from + figureCol(r.line)}`),
    }));
    for (const k of this.printed ? [] : marks) {
      const row = gutterRow(k);
      if (whole.has(k.thread)) continue;
      if (row >= top && row < top + room && (host?.externalGutter === undefined || (k.col ?? 0) + 4 <= host.externalGutter)) this.hits.push({ row, from: this.gutterStart + 1 + (k.col ?? 0), to: this.gutterStart + 1 + (k.col ?? 0) + 3, thread: k.thread, elem: `comment:${k.thread}` });
    }
    for (const c of controls) {
      const row = c.row - this.scroll;
      if (row >= 0 && row < room && c.from + bx < w) this.hits.push({ row: top + row, from: c.from + bx, to: Math.min(w, c.to + bx), thread: c.thread, elem: controlKey(c.thread, c.control, c.value) });
    }
    const window: RowGeometry = { at: r => { const row = r - this.scroll; return row >= 0 && row < room ? top + row : null; }, from: bx, to: w };
    this.hits.push(...pickTargets(picks?.rows ?? [], window));
    // A template's figures share one source line, so their container tint uses the figure's drawn bounds;
    // the selected row's own lines are the item band (PIE-969). The ruler wins over an open thread's passage tint.
    const reading = this.readingRows(), framedList = this.framedList(current);
    const figure = current?.link?.figure && doc.parts?.find(p => p.kind === "figure" && p.figure === current.link?.figure?.figure);
    const blockBand: [number, number] | null = figure ? [top + figure.row, top + figure.row + (figure.rows ?? 1)] : reading ? [top + reading[0], top + reading[1]] : null, readingBand = readingRuler() && !this.printed && !framedList ? (current?.item && blockBand ? blockBand : current?.ruler ?? blockBand) : null;
    // The element the cursor is on, when it is one row of something (a figure's row, a step): its rows are item-focused.
    const itemRows: [number, number] | null = current?.item && !this.printed && !framedList ? current.item : null;
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
      const W = i < top ? w : wideFigureAt(doc, row - top)?.cols ?? bodyW;
      // Item focus (PIE-969): the row the cursor is on inside a figure or list, over the container's ruler tint.
      if (itemRows && row >= itemRows[0] && row < itemRows[1]) {
        const band = paintRange(pad(l, W), 0, W, host?.focused === false ? ITEM_IDLE_BG : ITEM_BG);
        const bar = bx > 0 && row >= top ? putCell(band, bx - 1, theme().focus.item.glyph, fgRgb(theme().focus.item.bar)) : null;
        const item = this.paintSelection(marked(bar ?? band, row), row);
        return host?.focused === false ? item : selectFullText(item);
      }
      const tint = ruled(row) ? RULER_BG : readingBand && row >= readingBand[0] && row < readingBand[1] ? (host?.focused === false ? RULER_IDLE_BG : RULER_BG) : inQuote(row) ? THREAD_BG : null;
      if (tint) return this.paintSelection(marked(pictureRowsOf(doc.images, top - this.scroll).has(i) ? bandBesidePicture(pad(l, W), bx, tint) : paintRange(pad(l, W), 0, W, tint), row), row);
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
    this.hits.push(...copyControls(lines, doc, { at: r => { const row = r - this.scroll; return row >= 0 && row < room ? top + row : null; }, bx, w, now: blockNow }));
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
    // A fold head's gutter and the disclosure drawn at the heading's words (doc.ts's headingGlyph, PIE-1403) are targets of
    // the shared builder; the glyph is the first thing drawn at the body's start (indented or not), a ▸ in the words is never one.
    if (!this.printed) this.hits.push(...foldHeadTargets(doc.heads, key => { const n = this.foldsIn(m).points.findIndex(p => p.key === key); return n < 0 ? null : n + 1; }, window, {
      gutter: [this.gutterStart, this.gutterStart + 1],
      glyphCol: row => { let col = 0; for (const c of visible(lines[row] ?? "")) { if (col >= this.bx && c !== " ") return c === "▾" || c === "▸" ? col : null; col += width(c); } return null; },
    }));
    if (!this.printed) for (const hd of doc.heads) {
      const first = top + hd.row - this.scroll, rows = hd.rows ?? 1;
      if (first + rows <= top || first >= top + room) continue;
      const n = this.foldsIn(m).points.findIndex(p => p.key === hd.key);
      if (n < 0) continue;
      const folded = this.effectiveFolded(this.foldsIn(m).points[n]!);
      if (first >= top) gutterRows.set(first, dim(folded ? "▸" : "▾"));
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
      const col = p.col + (p.full ? 0 : bx), hit = p.full ? col + (host?.heroBounds?.col ?? 0) : col;
      if (row < 0 || row >= room || at >= lines.length || line === undefined || col >= (p.full ? p.cols! : w)) continue;
      if (this.zoom && this.zoom.start === line) continue;
      // A folded heading's row is its fold's (its …): W still zooms into it.
      if (p.kind === "heading" && this.foldsIn(m).points.some(f => f.line === p.line && this.effectiveFolded(f))) continue;
      const put = putCell(lines[at]!, col, ZOOM_GLYPH, fg(C.dark), p.kind === "figure" ? "·" : "");
      if (put === null) continue;
      lines[at] = put;
      this.hits.push({ row: at, from: hit, to: hit + 1, zoom: line });
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
      // A gutter too narrow for it (a whole-note card's takes no column, PIE-1572) drew it cut to "…": the card's own
      // [–] is its control there.
      if (host?.externalGutter === undefined && col + 3 > this.gutterWidth()) continue;
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
    this.figureSizing.place(doc, this.figuresDrawn, bx, host?.heroBounds?.col ?? 0, top, top + room, this.scroll, heroRows);
    const wide = lines.flatMap((_, row) => { const p = row >= top && wideFigureAt(doc, row - top + this.scroll); return p ? [{ row, col: host?.heroBounds?.col ?? 0, cols: p.cols! }] : []; });
    return room > 0 ? { lines, placements, gutter, headerBand, wide, scroll: { top: this.scroll, room, total: body.length } } : { lines, placements, headerBand };
  }

  /**
   * The note laid out at this width: its rows, links, elements and comment marks, everything but where it's
   * scrolled to. A frame in which only scrolling happened (onlyScrolled: the wheel and nothing else since the
   * last paint) reuses the last layout when the note and the pane's size are the same, so scrolling a long
   * note costs a slice, not a layout. Every other frame lays it out again.
   */
  private layOut(m: Msg, w: number, h: number, head: string[], summaryRow: number, summaryLinks: { from: number; to: number; link: Link; key: string; row?: number }[], host: SurfaceHost | undefined, src: Source | null): Laid {
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
    const key = `${footRows.join("\n")}|${writing ? `${writing.cs.place}:${writing.d.text.length}:${writing.d.row}:${writing.d.col}|` : ""}${w}x${h}|${top}|${summaryRow}|${m.revision ?? ""}|${m.text.length}|${host?.ctx.graphics ? 1 : 0}|${t?.cellW}x${t?.cellH}|${calloutsStamp(calloutsOf(src))}|${headingStylesStamp(headingStylesOf(src))}|${this.hero?.line ?? ""}|${this.raw ? "raw" : decorations.length}|${this.lastLook?.stamp ?? ""}|${this.bx},${this.bxRight}|${mcols}:${this.marginMode}|${openKey ?? ""}|${this.cur ?? ""}`;
    if (!this.form && this.sourcesMode?.place !== "inline" && !this.laid?.sourcesInline && onlyScrolled() && this.laid?.m === m && this.laid.key === key) return this.laid; // Live forms redraw to register their clickable choices each frame.
    this.fieldsDrawing.clear();
    // The header image is drawn above the title (render), so its line here is only its caption.
    const bw = Math.max(1, w - this.bx - this.bxRight - mcols);
    const look = this.lastLook;
    // A list's own look (PIE-675): its lead-in or heading line's fields, with this connection's tuning over them, by the note's line.
    const noteLine = this.foldsIn(m).lines;
    const lists = (n: number, f: Readonly<Record<string, string>>) => (noteLine[n] === undefined ? { ...f } : listFieldsTuned(this.src, m.id, noteLine[n]!, f));
    let listIndex = 0;
    const inlineList = (rows: string[], width: number, height?: number, figure?: string) => {
      const key = listIndex++;
      let list = this.inlineLists.get(key);
      if (!list) this.inlineLists.set(key, list = new InlineList());
      if (figure) this.figureSizing.lists.set(figure, list);
      return list.draw(key, rows, width, drawn, this.cur, height);
    };
    const env: DocEnv = { figures: { fullWidth: host?.heroBounds?.cols ?? w, viewport: (key, rows, cols, height) => this.printed && height === undefined ? rows : this.figureSizing.paint(key, inlineList(rows, cols, height, key), cols) }, ...(!this.printed ? { inlineList } : {}), ...this.docEnv(bw, host, Math.max(4, Math.round((h - head.length) * 0.8))), ...(this.hero ? { heroLine: noteLine.indexOf(this.hero.line) } : {}), regions: book, fields: this.fieldsDrawing, ...(look ? { look: { values: look.values, layers: look.layers, width: look.width, lists } } : {}) };
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
      note: m.id, several: linesThatRun(m, src).length > 1,
      markdown: (text: string, width: number) => drawIn("extension-text", presentLinks(printableBlock(text), false, null), env, {}, { width }).lines,
      // A view's Blockdown (a section a component lays out) is drawn as the body is: its links are links here.
      blockdown: (text: string, width: number) => drawIn("view", presentLinks(printableBlock(text), false, src, text, drawn), env, {}, { width }).lines,
      // A view's picture (PIE-827), laid out as the body's image lines are.
      // A render line's drawing: an element with its rows control; the one the reader draws above the note says only that it's the header.
      image: (node: ImagePrimitive, width: number, line?: number) => {
        const own = line === undefined || node.svg === undefined || node.caption === false ? undefined : this.printed || !isOutlineNote(m) || m.partial ? undefined : drawingControls(m, this.picturesOf(m), line, drawn);
        if (!own || line !== this.hero?.line) return pictureRows(node, width, env, drawn, own);
        return [drawingCaption(`▀ header ·`, node, width, own, this.heroRef(m)?.path ?? "", drawn)];
      },
      // A view's link names a block, or (PIE-754) a Resource the extension wants opened.
      row: (block: string, text: string) => tagged(drawn, isResourceRef(block) ? { resourceRef: block, label: block, role: "row" } : { block, role: "row" }, text),
      // A view's `list` (PIE-747): the one ListView, its state this reader's, its rows the reader's elements.
      ...(this.printed ? {} : { list: (node: ListPrimitive, width: number, run: (act: string) => LinkTarget) => this.viewList(node, width, run, this.listEnv, drawn, text => extDraw.markdown(text, Math.max(8, width))) }),
      hostKeys: host?.ownKeys ?? "",
    };
    const { doc: rendered, points, lines: noteLines } = this.body(m, env, src, drawn, tokens, (source, noteLines) => {
      const regions = regionsByLine(outline ? projectionsOf(m, src) : [], noteLines), bodyText = source.split("\n");
      // A view note's results under its body, drawn as an embedded view (the service's answer).
      const last = bodyText.length - 1, results = outline ? (width: number) => renderCollection({ props: { of: `((${m.id}))` }, key: "^view" }, m.id, width, this.listEnv, (to, text) => tagged(drawn, to, text)) : null;
      const view = !!results && (prop(m, "type") ?? "").toLowerCase() === "virtual-branch";
      // The rules' decorations (PIE-600): above or below what they matched, in its place, or around it.
      const plan = planDecorations(decorations, noteLines, { row: extDraw.row, press: (act, text) => tagged(drawn, { role: "control", label: text, press: { act, block: m.id, line: 0 } }, text), markdown: extDraw.markdown, blockdown: extDraw.blockdown, image: (node, width) => pictureRows(node, width, env, drawn), headings: headingStylesOf(src) }, bodyText);
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
      const on = target ? tagged(drawn, target.kind === "block" ? { block: target.blockId } : target.kind === "resource" ? { resourceRef: `resource:${target.resourceId}` } : { block: target.sourceBlockId },
        target.kind === "block" ? presentLinks(`((${target.blockId}))`, false, src) : target.kind === "resource" ? "Resource" : target.filePath) : context?.error ?? "reading comment subject…";
      const intro = drawIn("note", `on ${on}`, env);
      const outlinks = drawIn("note", "::outlinks", env, { note: m.id, tag: linkSink(drawn).tag });
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
    const inlineBox = writing?.cs.place === "inline" ? composerBox(writing.d, writing.f, Math.min(inlineRect.cols, 96), Math.max(5, Math.min(inlineRect.rows, h - top + 2))) : null; if (inlineBox && inlineBox.lines.length * 100 + (inlineBox.frame?.row ?? 0) !== this.composerDrawn) { this.composerDrawn = inlineBox.lines.length * 100 + (inlineBox.frame?.row ?? 0); if (this.composerAsked === this.scroll) this.revealComposer = true; this.composerAsked = null; /* what a key asked for reshaped its box (its height, or its status over the text), the note where it was then: the text stays in view; a resize or a wheel never moves the note (PIE-1560) */ }
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
    if (this.links.filter(l => l.media).map(l => l.media).join("\n") !== mediaLinks.map(l => l.media).join("\n")) this.links = [...this.links.filter(l => !l.media), ...mediaLinks];
    // The document keeps a minimum width of its own (callouts, tables); a narrower column clips it.
    const inset = " ".repeat(this.bx);
    // A card under its passage juts into the body's inset (PIE-1255), on its own background, so it reads as beside
    // the words, not in them; its cells (and its controls') stay where the body's are.
    const jut = Math.max(0, Math.min(2, this.bx - (host?.externalGutter !== undefined ? 0 : this.gutterWidth())));
    const cardAt = new Map<number, string>();
    if (jut) for (const c of threads.cards) for (let r = c.at; r < c.at + c.rows; r++) cardAt.set(shift(r) + (listInline && listInline.at <= shift(r) ? listInline.rows : 0), c.bg);
    const body = doc.lines.map((l, r) => {
      if (wideFigureAt(doc, r)) return l;
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
    for (const e of elems) if (wideFigureAt(doc, e.row - top)) { const dx = (host?.heroBounds?.col ?? 0) - this.bx; e.from += dx; e.to += dx; }
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
  private docEnv(width: number, host: SurfaceHost | undefined, maxImageRows: number): DocEnv {
    const d = host?.ctx?.dispatch;
    if (d) this.refusedPress = act => { try { return d.refusedNow(actRequestOf(lineWords(act)), USER); } catch { return null; } };
    const t = host?.ctx.t, graphics = !!host?.ctx.graphics;
    const noImages = graphics ? undefined : t?.kitty ? "video: cells · alt+v draws images" : "no Kitty graphics in this terminal";
    this.imageRowsMost = maxImageRows;
    return { width, cellW: t?.cellW ?? 9, cellH: t?.cellH ?? 18, graphics, noImages, maxImageRows, unfold: this.unfold, callouts: calloutsOf(this.src), headings: headingStylesOf(this.src), printed: this.printed,
      // A picture fence's source is the note as written (PIE-1555): decor.raw shows it, and its caption names the key.
      pictures: !this.raw, pictureSource: `${keyCaption(READER_KEYS.find(r => r.action === "decor.raw")?.key ?? "~")} shows its source` };
  }

  /** The note's body for the reader and a host's digest (folds, links, embeds, steps, tagged into `drawn`); `more`: the reader's own. */
  private body(m: Msg, env: DocEnv, src: Source | null, drawn: Link[], tokens?: ReturnType<typeof resourceTokensOf>, more?: (text: string, lines: readonly number[]) => Partial<DocEnv>) {
    let { text, points, lines, literal, anchors } = this.foldsIn(m, false);
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
    this.keepFolds(this.foldsIn(m).points);
    // The live figures this layout draws, each told here; a tab or the density drawn as a control.
    const figures: FigureInfo[] = [];
    this.figuresDrawn = figures;
    // The inline ::links components this layout draws (PIE-693), each told here.
    const blocks: ListHandle<any>[] = [];
    this.linkBlocksDrawn = blocks;
    env = { ...env,
      figures: this.printed ? { ...env.figures, all: true, seen: f => figures.push(f) } : {
        ...env.figures, drawn: { n: 0, titles: new Map() }, ui: key => { const selected = this.elems.find(e => e.key === this.cur)?.link; return { ...this.figureUI.get(key), size: this.figureSizing.preview(key), ...(selected?.figure?.figure === key ? { selected: { row: selected.figure.row, block: selected.block } } : {}) }; },
        tag: (c, x) => tagged(drawn, { role: "figure", figure: c, label: c.label ?? c.tab ?? (c.size ? "↔ fit/full" : `≡ density ${this.figureUI.get(c.figure)?.density ?? ""}`.trim()) }, x),
        seen: f => figures.push({ ...f, revision: f.revision ?? m.revision, line: f.note === m.id && f.line !== undefined ? lines[f.line] : f.line }),
      },
    };
    const { preview, spanPreview, ...hooks } = this.bodyHooks(m, lines, env, src, drawn);
    const additions = withBeside(more?.(text, lines) ?? {}, this.besideRegions(m, lines, src, preview));
    const after = additions.after, lastFormLine = text.split("\n").length - 1;
    if (form) additions.after = (line, width) => joinRows([
      after?.(line, width) ?? [],
      ...(line === lastFormLine ? [form.draw(width, this.modes.get("form")?.of === form, (field, value, act) => tagged(drawn, {
        role: "control", label: field, form: { field }, press: { act: `${act} tile=${m.id}`, block: m.id, line: 0 },
      }, value))] : []),
    ]);
    this.listEnv = this.printed ? undefined : {
      list: (key, signature) => this.listFor(key, false, signature),
      entered: key => this.listIn === key,
      current: () => this.listHost().current(),
      row: (key, row, to, x, group) => tagged(drawn, { ...to, listRow: { key, row, group } }, x),
      control: (key, x) => tagged(drawn, { role: "control", label: key, listRow: { key } }, x),
      ...(preview ? { preview } : {}), image: (node, width) => pictureRows(node, width, env, drawn),
      seen: info => blocks.push(info),
    };
    const doc = drawIn("note", presentLinks(text, expandsEmbeds(!!hooks.embed, m), src, m.text, drawn, tokens, isOutlineNote(m) ? { block: m.id, lines } : undefined), env, {
      literal, ...hooks, ...(isOutlineNote(m) ? { outputs: new Map(findOutputRegions(text).map(r => [r.startLine, r])) } : {}),
      linkBlocks: this.listEnv, componentLine: line => lines[line]!,
      callout: this.calloutHook(m, lines, points, drawn),
      image: this.imageHook(m, lines, drawn),
      // An artifact's card (PIE-793): its file read through the service, the card drawn again once it's read.
      ...(src && isOutlineNote(m) ? { artifact: spec => artifactFacts(spec, { scope: src.board, read: name => src.board.request("artifacts.show", { name }), changed: () => src.redraw() }) } : {}),
      folds: { points, folded: this.effectiveFolds(m), selected: this.foldSel, preview: new Set(points.filter(p => this.previews(p)).map(p => p.key)) },
      ...linkSink(drawn), note: m.id,
      ...additions,
    });
    this.drawnFolds = doc.folds ?? points;
    this.keepFolds(this.drawnFolds);
    return { doc, points: this.drawnFolds, lines };
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
    const pictures = new Map(this.picturesOf(m).map(p => [p.line, p]));
    return i => {
      const p = pictures.get(noteLines[i] ?? -1);
      return p ? imageRefTo(m, p) : null;
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

  private endPreviewDraft() {
    clearTimeout(this.previewDraft?.timer);
    this.previewDraft?.unlisten?.();
    // Watches belong to their connection: retiring the draft ends its service work too.
    this.previewDraft?.board?.close();
    this.previewDraft = undefined;
  }

  static draftPreviewDoc(text: string, width: number, src: Source | null, links: LinkTarget[]): Doc & { pending: boolean } {
    const env: DocEnv = { width: Math.max(10, width), cellW: 9, cellH: 18, graphics: false, maxImageRows: 8, unfold: true, callouts: calloutsOf(src), headings: headingStylesOf(src), button: inertButton };
    const hooks = blockdownHooks(NO_READER, null, [], env, src, links);
    const doc = drawIn("preview", presentLinks(text, expandsEmbeds(!!hooks.embed), src, text, links), env, hooks);
    return { ...doc, pending: !!src && embedsLoading(src.board) };
  }

  /**
   * Text written about the note (a comment's body, a reply, the composer's preview, an edit's ctrl+p preview: PIE-852)
   * drawn as the reader draws the note (PIE-770): references by their titles, `[[pages]]`, Markdown, and `!((embeds))` transcluded, through renderDoc and
   * presentLinks. Its links aren't elements: what's followable is the note's own.
   */
  snippet(text: string, width: number, host?: SurfaceHost): string[] { return this.snippetDoc(text, width, host).lines; }
  /** `snippet` with where its links are drawn (`links`: their targets, by `.links`' `n`), for a draft's preview to follow; `noteLines`: each line's in this note, its ::buttons live presses of them (the answer tile, PIE-1699). */
  snippetDoc(text: string, width: number, host?: SurfaceHost, drawn: Link[] = [], pictures = false, draftOf?: string, noteLines?: readonly number[]): { lines: string[]; links: LinkRange[]; pending: boolean; placements: Placement[]; images: DocImage[]; source: number[] } {
    const m = this.msg, src = this.src;
    // `pictures`: its img:: lines drawn as the reader draws them (PIE-846), where the terminal can; else each says what it is.
    const graphics = pictures && !!host?.ctx.graphics;
    const env: DocEnv = { ...this.docEnv(Math.max(10, width), host, 8), graphics, noImages: undefined, unfold: true, button: inertButton };
    const drawEmbed = m ? this.bodyHooks(m, [], env, src, drawn).embed : undefined, button = m && noteLines ? this.bodyHooks(m, noteLines, env, src, drawn).button : undefined;
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
    const doc = drawIn("snippet", presentLinks(printable(text.replace(/\t/g, " "), "", { lines: true }), expandsEmbeds(!!embed, m ?? undefined), src, text, drawn, undefined, draftOf && !site?.pending ? { block: draftOf, draft: true } : undefined), env, { ...(draftOf ? { note: draftOf, site } : {}), ...(embed ? { embed } : {}), ...(button ? { button } : {}) });
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

  private bodyHooks(m: Msg | null, noteLines: readonly number[], env: DocEnv, src: Source | null, drawn: Link[]) {
    // Read when drawn, not now: a body's list hooks are set after its hooks are made.
    const self = this;
    return blockdownHooks({ get context() { return self.context; }, refusedPress: act => self.refusedPress(act), get folded() { return self.folded; }, get foldSel() { return self.foldSel; }, get listEnv() { return self.listEnv; } }, m, noteLines, env, src, drawn);
  }

  /**
   * The note drawn once for a host that scrolls it itself (a river column, PIE-1543): its header as the reader draws it
   * (crumbs, title, byline, the header's rule) and its body through the same renderer as `render` (Markdown, links,
   * transclusions nested, step controls and an open status choice, folds ▾/▸, each code block's ⧉), with one index of
   * every press target (`header.targets` on the header's rows, `targets` on the body's) that `pressTarget` presses as
   * the reader's click does. The body is `w` wide, `inset` columns in (a host's margin: its lines start with it). Its
   * links, embeds, steps, fold points and the header's controls are this surface's elements: `[ ]` walks them, ⏎ and
   * space act on the current one. `current`: the body row of the current element, for the host to keep in view (a
   * header control's is above the body, negative); `source`: each body row's note line (-1: none), for a copy of the
   * source; `placements`: its images, laid out as the reader lays them out whenever the host draws Kitty graphics (at
   * most `maxImageRows` tall), for the host to cut to what it shows (`inWindow`). `stickyHeader` puts the header's
   * backdrop under it for how far the host has scrolled.
   */
  digest(m: Msg, w: number, host: SurfaceHost, maxImageRows = 8, inset = 0): DrawnNote {
    const src = this.use(host);
    this.lookAt(m, w, host);
    const hb = this.headerBlock(m, w, host, src);
    const head = [...hb.rows], headerRule = hb.rows.length ? this.headerRule(w) : "";
    if (headerRule) head.push(headerRule);
    const bw = Math.max(1, w - inset);
    this.drawn = null;
    this.digesting = true;
    // A digest's elements are counted as the reader's always were (one column in); its host draws its own margin.
    this.bx = 1; this.bxRight = 0;
    const drawn: Link[] = [];
    // A digest draws no header image above the note: it's drawn where it's written.
    this.hero = null;
    const { doc: rendered, points, lines: noteLines } = this.body(m, this.docEnv(bw, host, maxImageRows), src, drawn);
    const { doc, picks } = this.pickerRows(rendered, drawn, bw);
    this.digested = { m, w, maxImageRows, doc, lines: noteLines, head, inset };
    this.elems = this.elementsOf(doc, drawn, [], [], [], points, 0, [], 0, this.imageRefOf(m, noteLines));
    // The header's controls (the crumbs, a title decoration) are elements above the body, as in a reader.
    const header = this.headerTargets(m, hb, w);
    this.elems.unshift(...header.elems.map(e => ({ ...e, row: e.row - head.length, ruler: [e.ruler[0] - head.length, e.ruler[1] - head.length] as [number, number] })));
    this.keepCurrent(host);
    const current = this.elems.find(e => e.key === this.cur);
    const ruled = current && !this.framedList(current) ? current.ruler : null;
    const lines = doc.lines.map((l, r) => (ruled && r >= ruled[0] && r < ruled[1] && !pictureRowsOf(doc.images, 0).has(r) ? paintRange(pad(l, bw), 0, bw, RULER_BG) : l));
    const headLines = head.map((l, r) => (ruled && r - head.length >= ruled[0] && r - head.length < ruled[1] ? paintRange(pad(l, w), 0, w, RULER_BG) : l));
    const elemOf = new Map<Link, string>(this.elems.filter(e => e.link).map(e => [e.link!, e.key]));
    const targets: Hit[] = bodyTargets(doc, drawn, this.elems, { at: r => r, dx: () => 0, cols: () => Infinity, bx: 0, w: bw, elemBx: this.bx, top: 0, elemOf: r => { const l = drawn[r.n]; return l ? elemOf.get(l) : undefined; } });
    const whole: RowGeometry = { at: r => r, from: 0, to: bw };
    targets.push(...pickTargets(picks?.rows ?? [], whole));
    // Every row of a wrapped heading is its disclosure (PIE-1349).
    targets.push(...foldHeadTargets(doc.heads, key => { const n = points.findIndex(p => p.key === key); return n < 0 ? null : n + 1; }, whole));
    const copies = copyControls(lines, doc, { at: r => r, bx: 0, w: bw, now: current ? this.blockOf(current) : null });
    targets.push(...copies);
    const placements = imagePlacements(doc.images, 0, ...cellOf(host));
    onGround(lines, placements);
    // The host's margin: every body row starts `inset` columns in, its targets, pictures and copy cuts with it.
    const trims: Doc["trims"] = new Map();
    for (const [r, t] of doc.trims) trims.set(r, { ...t, cuts: (t.cuts ?? []).map(([a, z, rep]) => [a + inset, z + inset, rep] as [number, number, string?]) });
    for (const c of copies) if ("block" in c && doc.blocks[c.block]?.kind !== "span") { const t = trims.get(c.row) ?? { cuts: [] }; trims.set(c.row, { ...t, cuts: [...(t.cuts ?? []), [c.from + inset, c.to + inset]] }); }
    return {
      header: { lines: headLines, targets: header.hits },
      lines: lines.map((l, r) => ruled && r >= ruled[0] && r < ruled[1] && pictureRowsOf(doc.images, 0).has(r) ? bandBesidePicture(" ".repeat(inset) + l, inset, RULER_BG) : " ".repeat(inset) + l),
      targets: targets.map(t => ({ ...t, from: t.from + inset, to: t.to + inset })),
      placements: placements.map(p => ({ ...p, col: p.col + inset })),
      current: current ? current.row : null, key: current?.key ?? null, trims,
      source: doc.source.map(b => noteLines[b] ?? -1),
    };
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
    return { crumbs: this.pathLabel, comments: c ? { open: c.filter(x => x.open).length, total: c.length } : null, properties };
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
    // Each segment drawn on its own (`parts`: a narrow byline lays them over rows, PIE-1686), then joined as one line.
    const parts = segs.map(s => {
      const links: { from: number; to: number; link: Link; key: string }[] = [];
      let col = 0, line = fg(rest) + s.label + " "; col += [...s.label].length + 1;
      splitPropertyValue(s.value).forEach((v, j) => {
        if (j) { line += ", "; col += 2; }
        const t = valueTarget(s.key, v, prefix), n = [...v].length;
        if (t) { links.push({ from: col, to: col + n, link: t, key: s.key }); line += fg(C.lcyan) + v + fg(rest); }
        else line += v;
        col += n;
      });
      return { line, cols: col, links };
    });
    const links: { from: number; to: number; link: Link; key: string }[] = [];
    let col = 0;
    parts.forEach((p, i) => { if (i) col += 3; links.push(...p.links.map(l => ({ ...l, from: l.from + col, to: l.to + col }))); col += p.cols; });
    return { text: segs.map(s => s.plain).join(" · "), line: parts.map(p => p.line).join(" · "), links, parts };
  }

  /** The panel's rows for `m`: its own records (a comment's never its words' chips, PIE-1596), the service's once answered. */
  rows(m: Msg, tokens: PropertyRecord[] | null = null): PropRow[] {
    const t = tokens ? { state: "ready", tokens } : tokensOf(m.text, this.src);
    return propertyRows(m, t?.state === "ready" && t.tokens ? ownPropertyRecords(m.text, t.tokens) : null, workIdPrefix(this.src) ?? null, softLinkIgnoreOf(this.src));
  }

  /** Open (or switch to full) the property panel. */
  openPanel(full = false) {
    if (!this.panel) this.panel = new PropertyPanel();
    this.panel.full = full;
    this.panel.card = null;
  }

  settingsSchemaOf(m: Msg): ComponentSchema[] | null {
    const schemas = settingsSubject(this, m).schemas; return schemas.length ? schemas : null;
  }
  settingFields(m: Msg, _schema: readonly ComponentSchema[]): SettingField[] { return settingsSubject(this, m).fields; }
  closePanel(): boolean {
    if (this.panel?.field && this.panel.field.input.text !== this.panel.field.row.value && !this.panel.field.session.busy) return false;
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
  async followValue(r: Pick<PropRow, "key" | "target" | "line">, host: SurfaceHost, how: OpenHow = { link: true }): Promise<Msg | null> {
    const t = r.target;
    let target: Msg | null = null, why = "";
    if (!t) why = `${r.key} holds plain text; there is nothing to follow`;
    else if ("soft" in t) {
      const m = await followSoft(this.pageOffers, { name: t.soft, ...(this.msg && isOutlineNote(this.msg) ? { block: this.msg.id } : {}), ...(r.line !== undefined ? { line: r.line } : {}) }, host, how);
      if (m && "choices" in m) throw new ActionRefused(`more than one ${m.words}: ${m.choices.map(c => c.id ? `${c.label} (${c.id})` : c.label).join(", ")}; open id=<id> opens the one you mean`);
      if (m) this.panel = null;
      return m as Msg | null;
    }
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
    const board = () => { if (!this.src) throw new Error("no connection to the outline"); return this.src.board; };
    this.panel.field = valueField({ ...m, revision: m.revision }, this.rows(m), r, {
      write: (note, revision, row, value, by) => this.patchValue(note, revision, row, value, board(), by),
      read: async () => { const now = await board().get(m.id), t = now && await tokensFor(now.text, this.src); return now && { m: now, rows: this.rows(now, t?.state === "ready" ? t.tokens : null) }; },
    }, { redraw: () => this.src?.redraw(), said: text => this.context?.flash(text) });
  }

  /**
   * One `properties.patch` of `row`'s token in `m`, at `revision`: the revision `row`'s ordinal was read
   * from, so the service refuses it if the note has moved on. Returns the saved note (also shown here).
   */
  async patchValue(m: Msg, revision: number, row: PropRow, value: string, board: SocketBoard, actor: Actor): Promise<Msg> {
    // Never underneath a draft someone has open on that note (the draft session's agent rule).
    const no = agentRefusal(actor, { board, blockId: m.id });
    if (no) throw new ActionRefused(no);
    let ordinal = row.ordinal;
    if (ordinal === null) {
      // No properties.preview on this service: ask it for this key's tokens, at the same revision.
      const t = await board.propertyTokens(m.id, row.key);
      if (t.revision !== revision) throw new EditConflict(m.id, "changed since the panel read it");
      const nth = this.rows(m).filter(r => r.key === row.key && r.n <= row.n).length - 1;
      ordinal = t.tokens.filter(x => x.scope === "block")[nth]?.ordinal ?? null;
      if (ordinal === null) throw new Error(`the service doesn't list ${row.key} on the note any more`);
    }
    const saved = await board.patchProperties(m.id, revision, [{ op: "replace", ordinal, value }], actor);
    if (this.msg?.id === m.id) { this.refresh({ ...saved, childIds: this.msg.childIds }); this.links = linksOf(this.msg!); }
    return saved;
  }

  /**
   * Save the value being typed, through its session (a refusal, a stale one included, is said on its line and keeps the
   * text). Returns the new revision, or null.
   */
  async saveValue(host: SurfaceHost, actor: Actor = host.actor ?? USER): Promise<number | null> {
    const f = this.panel?.field, m = this.msg, was = f?.row.value ?? "", value = f?.input.text.trim() ?? "";
    if (!f || !m || f.session.busy) return null;
    const r = await f.session.submit(actor).finally(() => host.redraw());
    if (!r.ok) return null;
    if (this.panel?.field === f) this.panel.field = null;
    const said = r.said ?? `saved · revision ${r.revision} · ${f.row.key}: ${printable(was)} → ${printable(value)}`;
    if (this.panel) this.panel.note = said;
    if (r.said === undefined) host.ctx.flash(said);
    return r.revision ?? m.revision ?? null;
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
    const page = k.kind === "pgdn" || (ch(k) === " " && !P.field && !P.card?.editing) ? 1 : k.kind === "pgup" ? -1 : 0;
    if (page) {
      if (P.full && m && !m.partial) { const n = this.rows(m).length; if (n) P.sel = Math.max(0, Math.min(n - 1, P.sel + this.pageBy(page))); P.note = ""; }
      else this.scroll = scrolled(this.scroll, this.pageBy(page), this.maxScroll);
      host.redraw();
      return true;
    }
    if (!m || m.partial) { if (k.kind === "esc" || ch(k) === "i") void this.runKey("props.close", {}, host); host.redraw(); return true; }
    if (P.card) return settingsKey(this, k, host);
    const rows = this.rows(m);
    const intent = P.key(k, rows.length);
    const r = rows[P.sel];
    // The panel's commands are the props.* actions (PIE-506); moving its selection and typing a value are its own.
    if (intent === "close") void this.runKey("props.close", {}, host);
    else if (intent === "full") P.full = !P.full;
    else if (intent === "cancel") { P.field?.session.dispose(); P.field = null; P.note = ""; }
    else if (intent === "reload") void this.runKey("edit.reload", {}, host);
    else if (intent === "save") void this.saveValue(host);
    else if (r && intent === "copy") void this.runKey("props.copy", { n: r.n }, host);
    else if (r && intent === "follow") void this.runKey("props.follow", { n: r.n }, host, true);
    else if (r && intent === "summary") void this.runKey("props.summary", { toggle: r.key }, host);
    else if (r && intent === "edit") { try { this.editValue(r); } catch (e) { P.note = (e as Error).message; } }
    host.redraw();
    return true;
  }

  // ── the edit's drawing and its preview (ctrl+p) ──────────────────────────────
  /**
   * What each handler line last drew (an extension's output or a script's view), kept under its line while the note is
   * edited, read-only (PIE-981): `Draft.kept` for the raw edit and the rich one. The note as it was read says which line
   * drew what; a line that moved since (a line typed above it) still gets its drawing, found by its text.
   */
  private keptDrawings(d: Draft, m: Msg): Draft["views"]["raw"]["kept"] {
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
    if (attached && d.views.raw.preview && host && !elementEdit(d).on) return this.renderEditPreview(d, m, w, h, away, host);
    const kept = this.keptDrawings(d, m), help = host ? this.buttonEditing(d, host) : null;
    d.views.raw.inks = help?.inks ?? null;
    d.views.raw.kept = help ? (line, width) => [...(kept?.(line, width) ?? []), ...help.under(line, width)] : kept;
    const by = writtenBy(d, "save");
    if (elementEdit(d).on) return { lines: elementEdit(d).render(w, h, (t, width) => this.snippetDoc(t, width), by ?? undefined) };
    return { lines: renderEditor(d, {
      look: this.lastLook?.values, attachedPreview: !!host,
      preview: (t, pw, links) => this.snippetDoc(t, pw, undefined, links, false, isOutlineNote(m) ? m.id : undefined), pick: true, follow: true, ...(away ? { away } : {}),
      // A new note says where it lands, a click to move it (PIE-883).
      ...(this.newNotes.has(m.id) ? { lands: `→ ${this.pathLabel}` } : {}),
      title: `editing · ${subject({ ...m, text: d.text })}`,
      status: [
        ...editState(d, w),
        // Who typed it takes the hint's row, not a row of its own: an agent's patch landing never moves the text down. What
        // the draft says (an ask: the undo at a save) wraps onto up to three rows rather than being cut (PIE-1428).
        ...d.note ? saidRows(d.note, w, 3, C.cyan)
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
    lines[0] = pad(lines[0]!, Math.max(0, w - width(chip))) + fg(C.lcyan) + chip + RESET;
    return { lines, placements: d.views.raw.frame?.preview?.placements };
  }

  /** The draft with its live preview attached (inline is a split under it). */
  private renderEditPreview(d: Draft, m: Msg, w: number, h: number, away: boolean, host: SurfaceHost): SurfaceView {
    const p = this.editPreview;
    p.frame = null;
    const read = (cols: number, rows: number): SurfaceView => this.renderDraft(d, m, cols, rows, away, host, false);
    if (p.place === "tile") return read(w, h);
    p.rect = null;
    if (p.place === "floating" || p.place === "popup") return this.attachments.float("edit-preview", read(w, h), w, h, host, this.innerFrame);
    return this.attachments.beside(w, h, (cols, rows, row, col) => this.editPreviewRows(cols, rows, row, col, host, col > 0), read, "edit-preview");
  }

  editPreviewKey(k: Key, host: SurfaceHost): boolean {
    if (this.placementMenu) return this.modes.key(k, host) ?? true;
    const binding = modeBinding(EDIT_PREVIEW_KEYS, k);
    if (binding) {
      void this.runKey(binding.action as keyof NoteActionArgs, binding.args as never, host);
    }
    return true;
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
    try { fresh = await host.ctx.board.get(m.id); if (fresh?.revision !== undefined) await followHistory(fresh.id, fresh.revision, host.ctx.board); } // the last edit's history, through what agents wrote because of its save (PIE-1733)
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
    const now = () => host.current?.() ?? host, redraw = () => now().redraw();   // the reader's host now, not the one it opened with (PIE-1716)
    const target = blockTarget(fresh, {
      board: host.ctx.board, isNew: this.newNotes.has(fresh.id),
      saved: (m, by, asked, change) => this.saved(m, by, asked, change, now()),
      reread: m => { if (this.msg?.id === m.id) this.msg = this.rereadNote(m); },
      redraw,
    });
    this.anchorView(); if (this.scroll === 0) this.position.view = null; // A reader at its top opens the edit at its top, its title in view (PIE-1560).
    const row = fresh.text.slice(0, this.position.reading).split("\n").length - 1;
    this.position.cursor = { row, col: 0 }; this.readingLine(row);
    const s: DraftSession = DraftSession.open(target, { text: fresh.text, base: fresh.revision ?? 0, props: propertyListOf(fresh), by: host.actor ?? USER, position: this.position }, {
      board: host.ctx.board, redraw, said: text => host.ctx.flash(text, 8000),
      agentDid: (by, did) => this.noteAgent(by, did, s.draft),
      // The person's own `@name` line invites its answer beside their edit (as the draft rule reads it): an agent's
      // answer tile opens there even while they type, the keys staying in the edit (PIE-1294).
      answered: (ask, by, fold) => {
        const as = s.openedBy.kind === "user" && by.kind === "agent" ? { ...by, invitation: INVITES.mint("your ask", ["shape"]) } : by;
        const at = now(); void this.act("ask.beside", { ask, ...(fold ? { fold } : {}) }, at, as).catch(e => at.ctx.flash(String(e), undefined, errorDetails(e))); if (s.draft.lines[s.draft.row] === ask) s.draft.following(ask);   // the cursor still on it (one ↑ up its wrap, PIE-1757): typing on it follows
      },
      closed: how => this.draftClosed(s, how, now()),
    });
    s.draft.onAskSelected = (ask, fold) => { void this.runKey("ask.beside", { ask, fold }, now()); }; s.draft.following((host.current?.() ?? host).shownAsk?.()); s.draft.answerAt = () => (host.current?.() ?? host).answerAt?.(); // beside an answer tile already there, typing on its ask follows it; its row says where it is
    if (this.drawn && s.draft.restored === null) { const rows = this.readingRows(); s.draft.landInView = !rows || rows[0] < this.scroll || rows[0] >= this.scroll + this.drawn.room; } // The wheel left the reading line's first row behind: the words go where the person is looking (PIE-1579).
    this.msg = this.rereadNote(fresh);
    this.modes.push(this.draftMode(s));
    return s;
  }

  // ── a note's replies list and the revision compare (PIE-1433) ────────────────
  private replyRowAt(x: number, y: number): LinkRow | undefined {
    const mode = this.replyLinks;
    if (!mode) return;
    y += this.heroTop;
    const r = mode.rect;
    if (x < r.x || x >= r.x + r.w || y <= r.y || y >= r.y + r.h) return;
    return mode.rowsAt[mode.drawnItems[y - r.y - 1] ?? -1];
  }

  closeReplyLinks() { this.modes.drop("replies"); }
  closeRevision() { this.revisionAsk = null; this.modes.drop("revision"); }
  /** The compare takes the keys (on), or leaves them to a comment being written: it opens without them over one. */
  focusRevision(host: SurfaceHost, on: boolean) {
    const rv = this.revisionMode;
    if (!rv) throw new ActionRefused(REFUSED.noCompare);
    this.modes.focus(rv, on);
    if (on) host.enterMode?.();
    host.redraw();
    return { keys: on ? "revision" : "reader" };
  }

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
        y += this.heroTop;
        const r = mode.rect;
        // A click outside it while a comment is being written gives the comment its keys back; one in it, the compare.
        if (!inRect(r, x, y)) { if (this.session && this.modes.active(mode)) run("revision.focus", { on: false }); return undefined; }
        if (!this.modes.active(mode)) run("revision.focus", { on: true });
        if (y === r.y) { const c = mode.controls.find(hit => x - r.x >= hit.from && x - r.x < hit.to); if (c) run(c.action); }
        return true;
      },
      wheel: (dir, _host, at) => {
        const r = mode.rect, y = at ? at.y + this.heroTop : -1;
        if (!at || !inRect(r, at.x, y)) return false;
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
    const [replies, links, backlinks, thread] = await Promise.all([readReplies(host.ctx.board, m.id, host.conference), host.ctx.board.request("blocks.authored-links", { ownerBlockId: m.id }), host.ctx.board.backlinks(m.id), readThread(host.ctx.board, m, host.conference)]);
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
        y += this.heroTop;
        const r = mode.rect;
        if (!inRect(r, x, y)) return undefined;
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
    return { look: host?.look?.values ?? this.lastLook?.values, title: `reply · ${subject(this.replyParent!)}`, status: [], draftStatus: { state: false, said: this.draft?.note || null }, pick: true, follow: true,
      preview: (text, w, links) => this.snippetDoc(text, w, host, links),
    };
  }

  // ── editing, continued: replies, new notes, buttons, saving and leaving ──────
  async quoteSelection(host: SurfaceHost, actor: Actor, quote?: string): Promise<string> {
    const m = this.requireNote(), passage = this.passageFor(actor, quote).note;
    const line = m.text.slice(0, passage.start).split("\n").length - 1;
    const { items } = await host.ctx.board.request("fragments.candidates", { query: { blockIds: [m.id], fragmentQuery: passage.quote, mode: "passage", limit: 100 } });
    const anchor = items.find(c => c.revision === m.revision && c.lineIndex === line && c.fragmentId)?.fragmentId;
    // The excerpt is frozen even when its source changes or an anchor cannot yet be written.
    return `> [!quote]\n${passage.quote.split("\n").map(l => `> ${l}`).join("\n")}\n> — ((${m.id}${anchor ? `^${anchor}` : ""}))\n\n`;
  }

  startReply(host: SurfaceHost, quote?: string): DraftSession {
    if (this.editing) throw new ActionRefused(`finish the open draft first · ${this.holdingHint()}`);
    const parent = this.requireNote();
    const target = noteReplyTarget(parent, host.ctx.board);
    const s: DraftSession = DraftSession.open(target, { text: `re:: ${subject(parent)}\n\n`, by: host.actor ?? USER }, {
      board: host.ctx.board, redraw: () => host.redraw(), said: text => host.ctx.flash(text, 8000),
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
    if (s.holding(k, held => void this.draftKey(held, host))) { host.redraw(); return true; }
    if (!s.replaying && s.draft.views.raw.preview && modeBinding(EDIT_PREVIEW_READER_KEYS, k) && !completionOf(s.draft)) return this.editPreviewKey(k, host);
    if (!s.replaying && this.replyParent && ch(k) === '"' && this.selection) { void this.runKey("note.quote", {}, host); return true; }
    if (this.replyParent && (k.kind === "pgup" || k.kind === "pgdn")) { this.scrollKey(k, host); return true; }
    if (elementEdit(s.draft).key(k, (action, args = {}) => { if (!s.replaying || action !== "rich.toggle") void this.runKey(action, args, host); })) { host.redraw(); return true; }
    // A note's own edit runs actions where the person types (PIE-1076): ctrl+k lists them, ⏎ on a / line runs it.
    if (s.draft === this.draft && !s.replaying && !completionOf(s.draft)?.items.length) {
      const own = modeBinding(NOTE_EDIT_KEYS, k);
      if (own && !("shift" in k && k.shift)) { void this.runKey(own.action as never, (own.args ?? {}) as never, host); return true; }
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
        else if (cmd === "image" || cmd === "drop") void (cmd === "drop" ? this.runKey("draft.drop", { text: s.dropped }, host) : this.runKey("draft.image", {}, host));
        else if (cmd === "reload") void this.runKey("edit.reload", {}, host);
        else if (cmd === "copy") void this.runKey("draft.copy", {}, host);
        // Esc closes an unchanged edit; esc, esc on changed text puts it aside as unsent (never dropped), and says where.
        else void this.runKey("edit.close", cmd === "discard" ? { discard: true } : {}, host);
      },
    });
    host.redraw();
    return true;
  }

  /** Only a note's own edit offers its unsaved headings; comments and replies have no note of their own. */
  completer(d: Draft, host: SurfaceHost) {
    const c = completerFor(d, host.ctx.board, () => host.redraw(), action => {
      if (action) this.noteAgent(action.by, action.did, d);
      return d === this.draft ? { blockId: d.blockId, text: d.text } : undefined;
    });
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
    this.commentsAgain?.cancel();
  }

  /**
   * The edit's session ended: written, closed with nothing changed, or put aside as unsent. What an agent did
   * to it is said no longer as if it were still open: gone once saved or closed, in the past tense once put aside.
   */
  private draftClosed(s: DraftSession, how: Ended, host?: SurfaceHost) {
    if (this.drafting !== s) return;
    if (!this.replyParent && !s.draft.stillLanded) { this.position.reading = s.draft.offsetOf(s.draft.row, 0); const c = this.position.caret; if (c?.line === s.draft.row) this.position.view = { line: c.line, row: Math.max(c.row, this.positionRows.origin) }; } // the line typed last stays on its row, below this header: answers draw taller here than in the edit (PIE-1585)
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
    if (!m) return this.pathLabel;
    const a = await host.ctx.board.ancestors(m.id);
    if (this.msg?.id === m.id) { this.ancestors = a; this.pathNote = ""; host.redraw(); }
    return this.pathLabel;
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
  private buttonEditing(d: Draft, host: SurfaceHost): { inks: NonNullable<Draft["views"]["raw"]["inks"]>; under: (line: number, w: number) => string[] } | null {
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
    const all = () => (listed ??= host.ctx.dispatch?.list().actions ?? []);
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

  /** ctrl+r, keys or act: the draft with the keys reloads, by its session (its comment's, which keeps the env its reads go through). */
  async reload(host: SurfaceHost, actor: Actor) {
    const cs = this.session, writing = cs?.mode === "compose" ? cs.writing : null;
    const comment = writing && (this.modes.top()?.name === "comment" || !this.drafting) ? cs : null;
    const s = comment ? writing : this.draftSession();
    if (!s) throw new ActionRefused("nothing is being edited here");
    if (s.busy) throw new ActionRefused(s.status.phase === "reloading" ? "it's reloading already" : REFUSED.saving);
    if (comment) { if (actor.kind !== "agent") this.revealComposerNext(); await comment.reload(this.env(host, actor)); }
    else await s.reload();
    host.redraw();
    const revision = comment ? comment.revision : s.draft.base; return { ...(revision ? { baseRevision: revision } : {}), note: s.draft.note || null, ...(comment ? { mode: comment.mode } : {}) };
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
    if (d.busy) throw new ActionRefused(REFUSED.saving);
    const r = await pickInto(host.ctx, d, { socket: host.ctx.board.path, name: host.ctx.board.outline }, {
      ...(channel !== undefined ? { channel } : {}),
      cwd: await pickerCwd(host.ctx.board, { blockId: this.msg?.id, ...(this.draft === d ? { draft: { text: d.text }, line: d.row } : {}) }),
      held: () => this.draft === d || this.session?.composer === d,
    });
    if ("kept" in r) host.ctx.flash(`${r.why}: ${r.kept} · copied to ${r.at}`, 12000);
    else if ("nothing" in r) d.status.say(r.nothing);
    host.redraw();
    return r;
  }

  // ── comments ───────────────────────────────────────────────────────────────

  async loadComments(host: SurfaceHost, retry = false, strict = false): Promise<void> {
    const id = this.msg?.id;
    if (!id) return;
    try {
      let stale = false;
      const c = onTheirWords(alignComments(await host.ctx.board.comments(id, this.msg?.resource ? { revision: this.msg.revision, stale: () => { stale = true; } } : undefined), this.msg), this.msg?.text);
      // A Resource whose file changed since it was drawn: read again (the quotes were placed in the new text), once.
      if (stale && this.msg?.id === id && !retry) {
        const now = await host.ctx.board.get(id);
        if (now && this.msg?.id === id) { this.refresh(rereadResource(now, this.msg)); return this.loadComments(host, true, strict); }
      }
      if (this.msg?.id !== id) return;
      this.comments = c; this.commentsFor = id;
      // A thread that's gone (deleted, or the note's comments re-read elsewhere) isn't kept expanded.
      for (const t of this.expanded) if (!c.some(x => x.id === t)) this.expanded.delete(t);
      if (this.session?.mode === "threads" && !this.session.busy) this.session.threads = c; this.session?.commentsChanged(c);
      host.redraw();
    } catch (e) { if (strict) throw e; /* comments are extra; the note still reads */ }
  }

  /** Outline changed: a comment on this note (`commentNotes`) may have been added, answered or resolved anywhere. */
  onEvent(host: SurfaceHost, e?: OutlineEvent) {
    if (this.replyLinks && (!e || heardBy(e, "any"))) void this.openReplyLinks(host, USER, true).catch(err => host.ctx.flash(String(err), undefined, errorDetails(err)));
    if (!this.msg) return;
    this.commentsHost = host;
    const again = this.commentsAgain ??= new AskAgain<void>({ read: () => this.loadComments(this.commentsHost!), show() {}, notes: commentNotes(this) });
    if (e) again.heard(e); else again.soon();
  }

  private commentEnv(host: SurfaceHost, actor: Actor = host.actor ?? USER): CommentEnv {
    return {
      board: host.ctx.board,
      fetch: id => host.ctx.board.get(id).then(n => n && this.msg ? rereadResource(n, this.msg) : n),
      setMsg: m => { if (this.msg?.id === m.id) { this.msg = { ...this.rereadNote(m), childIds: m.childIds.length ? m.childIds : this.msg.childIds }; this.links = linksOf(this.msg); } },
      reloadComments: async (strict = false) => { await this.loadComments(host, false, strict); return this.comments ?? []; },
      external: () => void this.runKey("edit.external", {}, host),
      pick: () => void this.runKey("draft.pick", {}, host),
      follow: () => void this.runKey("edit.follow", {}, host),
      image: dropped => void (dropped === undefined ? this.runKey("draft.image", {}, host) : this.runKey("draft.drop", { text: dropped }, host)),
      reload: () => void this.runKey("edit.reload", {}, host),
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
    if (!await this.takeForComment(m, fresh, host, still)) return;
    this.session = new CommentSession(fresh, this.comments ?? [], mode);
    this.placeComment(this.session, host);
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
   * `m` read again as `fresh` for a comment (C, comment.note), its threads read too: false when the person moved on
   * meanwhile (another note, an edit), and nothing opens.
   */
  private async takeForComment(m: Msg, fresh: Msg, host: SurfaceHost, still?: () => boolean): Promise<boolean> {
    this.msg = this.rereadNote(fresh);
    if (this.commentsFor !== m.id) await this.loadComments(host);
    return !((still && !still()) || this.msg?.id !== m.id || this.editing);
  }

  /** A comment's place where this host can draw it: a tile where there are none to be had (the BBS reader, a river column) is split, the nearest. */
  private placeComment(s: CommentSession, host: SurfaceHost) { if (s.place === "tile" && !host.attachedTile) s.place = "split"; }

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
    if (!await this.takeForComment(m, fresh, host, still)) return;
    // Another comment opened while this one was read (a second C, an act): the one being written stays.
    if ((this.session as CommentSession | null)?.mode === "compose") return "a comment is being written here: send it (ctrl+s) or put it aside (esc twice) first";
    const s = new CommentSession(fresh, this.comments ?? [], "threads");
    this.placeComment(s, host);
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
    const d = s.draft, self = this;
    return {
      get keys() { return d.views.raw.preview ? EDIT_PREVIEW_READER_KEYS : [...DRAFT_KEYS, ...draftChordRows(), ...(d === self.draft && !self.replyParent ? NOTE_EDIT_KEYS : [])]; },
      name: "draft", of: d, session: s, holdsKeys: true, noun: "the edit",
      word: "edit",
      escCloses: () => (d.views.raw.preview ? "the preview" : elementEdit(d).on ? "the table edit" : draftEscCloses(d, "the edit")),
      changed: revision => { if (!this.replyParent) s.changedTo(revision); },
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
      hint: () => d.views.raw.preview && !completionOf(d) ? modeHint(EDIT_PREVIEW_READER_KEYS, action => NOTE_ACTIONS.def(action)) : this.replyParent ? replyHint(d.dirty) : (elementEdit(d).on ? hintOf(ELEMENT_KEYS.filter(r => r.action !== "edit.save")) + " · " : "") + (imagePathAt(d.lines[d.row] ?? "", d.col) ? hintOf([rk("ctrl+v", "draft.image", "makes that path a picture")]) + " · " : "") + editHint(d, { save: "save", reload: d.status.conflict || d.status.changedElsewhere ? "reload" : null, follow: true }),
      state: () => `editing${d.dirty ? " · unsaved" : ""}`,
      describe: () => ({ ...s.describe(), previewPlace: this.editPreview.place, previewSplit: this.attachments.splits["edit-preview"], rich: elementEdit(d).on, writtenBy: writtenBy(d, "save") }),
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
      // ctrl+r is the draft's own key (DRAFT_KEYS), named only when there's something to reload: first, beside the warning, so a narrow footer keeps it (PIE-1664).
      get keys() { return cs.mode === "compose" ? [...(cs.composer?.status.conflict || cs.composer?.status.changedElsewhere ? DRAFT_KEYS.filter(row => row.action === "edit.reload").map(row => ({ ...row, label: cs.target?.kind === "quote" ? "find quote" : "reload" })) : []), ...commentKeys(cs.composer ? draftEscCloses(cs.composer, "the comment") : null)] : undefined; },
      name: "comment", of: cs, session: cs, holdsKeys: true, noun: "the comment", word: "comment",
      // The note moved on: a comment on a passage of it, or on the whole of it, is told as a note's edit is (PIE-1658).
      changed: revision => cs.noteChanged(revision),
      // Its way out: what was over it went with it (a grip, the placement menu, the leave ask); the keys it took go back.
      dropped: () => {
        if (this.revisionMode) this.modes.focus(this.revisionMode, true);
        if (this.sourcesMode) this.modes.focus(this.sourcesMode, true);
        this.boxRect = null;
      },
      escCloses: () => (cs.mode === "compose" && cs.composer ? draftEscCloses(cs.composer, "the comment") : cs.mode === "threads" ? "the thread list" : "the comment"),
      // The passage picker and the thread list are drawn in place of the note; the composer is drawn in it (PIE-770).
      // In its own tile (PIE-846) the list and the picker are drawn there, and the note here stays as it was.
      editing: () => true, covers: () => cs.mode !== "compose" && cs.place !== "tile",
      key: (k, host) => this.commentKey(cs, k, host),
      // Beside the box, a click on a link, a comment mark or back and forward goes there, asking first (PIE-785); one in the completion popup, at the caret beyond the box, is the popup's (PIE-1511).
      click: (x, y, host) => {
        const w = writing(), r = w && completerOf(w)?.within(x, y) ? null : this.boxRect;
        if ((cs.place === "floating" || cs.place === "popup") && r && (x < r.col || x >= r.col + r.cols || y < r.row || y >= r.row + r.rows)) return undefined;
        if (this.floatAt(x, y + this.heroTop, host) === "comment" && this.sourcesMode) void this.runKey("sources.focus", { on: false }, host);
        const d = writing();
        return d ? this.writeClick(d, x, y, host) || this.followFromComposer(x, y, host) : cs.mode === "compose" && cs.place === "tile" ? this.followFromComposer(x, y, host) : false;
      },
      press: (x, y, host, drag) => {
        const d = writing();
        if (this.sourcesMode && this.boxRect && x >= this.boxRect.col && x < this.boxRect.col + this.boxRect.cols && y >= this.boxRect.row && y < this.boxRect.row + this.boxRect.rows) void this.runKey("sources.focus", { on: false }, host);
        if (!d) return false;
        // The floating box's top edge moves it, its ◢ corner and edges size it (PIE-785): comment.move, as ctrl+g's keys run it.
        const r = !drag && cs.place === "floating" && !completerOf(d)?.within(x, y) ? this.boxRect : null, z = r && frameZone(r, x, y);
        if (z) { this.pointer.hold({ kind: "frame", target: "comment", zone: z, x, y, from: r! }); return true; }
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
      rows: (w, h, host) => { this.use(host); return this.msg && !(cs.place === "tile" && host?.attachedTile) ? { lines: cs.render(w, h, subject(this.msg), (t, pw, links) => this.snippetDoc(t, pw, undefined, links)) } : null; },
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
      ended: () => cs.done,
    };
    return mode;
  }

  // ── the inline lists (PIE-693, PIE-747): a ::links component, an extension's list view; their rows, picks, the person in one ──

  private viewList(node: ListPrimitive, width: number, run: (act: string) => LinkTarget, lb: LinkBlocksEnv | undefined, drawn: Link[], markdown: (text: string) => string[]): string[] {
    return renderPrimitiveList(this, node, width, run, lb, (to, text) => tagged(drawn, to, text), markdown);
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

  /** The entered list owns selection even while a page turn has no drawn row element yet. */
  private framedList(e: Element | undefined): boolean {
    const key = this.listIn ?? e?.link?.listRow?.key;
    return key !== undefined && this.listViews.get(key)?.selectionStyle === "frame";
  }

  listNamed(named?: string): ListHandle<any> { return listNamed(this.listHost(), named); }

  /** The element drawn for row `row` of list `key`, and its number among the elements (from 1), or null. */
  linkRowElement(key: string, row: string, group?: string): { e: Element; n: number; row?: number } | null {
    const i = this.elems.findIndex(e => e.link?.listRow?.key === key && e.link.listRow.row === row && (group === undefined || e.link.listRow.group === group));
    if (i >= 0) return { e: this.elems[i]!, n: i + 1 };
    for (const [listKey, list] of this.inlineLists) {
      const index = list.rows.findIndex(r => r.target.listRow?.key === key && r.target.listRow.row === row && (group === undefined || r.target.listRow.group === group));
      const n = this.elems.findIndex(e => e.link?.inlineList?.key === listKey);
      if (index >= 0 && n >= 0) return { e: this.inlineRowElement(this.elems[n]!, index), n: n + 1, row: index + 1 };
    }
    return null;
  }

  selectedElement(): Element | undefined {
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

  async previewRow(host: SurfaceHost, target = this.selectedElement()?.link) {
    const selected = this.cur;
    if (!target?.block || target.role !== "row" || !host.preview) return;
    const m = await host.ctx.board.get(target.block);
    const list = target.listRow, pick = list && this.listViews.get(list.key)?.picked();
    const current = list?.row ? pick?.id === list.row && pick?.group === list.group : this.cur === selected;
    if (m && current) host.preview!(m, target.openWhere);
  }

  /** The person's pick in list `l` moves to row `row`: the [ ] position goes with it, so the ruler and the preview agree. */
  selectListRow(l: ListHandle<any>, row: string, group?: string) {
    l.view.pick(PERSON, row, group);
    const at = this.linkRowElement(l.key, row, group);
    if (at) { this.setElem(at.e); this.pendingRow = null; }
    else this.pendingRow = { key: l.key, row, group };
    this.reveal = true;
  }

  /**
   * The person goes into list `l` (a ::links list: its rows take j k ⏎ / esc), or comes out of it; `at` picks its first or
   * last row (a walk by j or k, PIE-1491). A collection has no mode (PIE-1501): going in is the [ ] position on its row.
   */
  enterList(l: ListHandle<any>, on: boolean, at?: "first" | "last") {
    if (!on) { this.leaveList(l.key); this.letGo(); return; }
    if (this.listIn !== l.key && !l.collection) this.modes.push(listMode(this, l.key, l.title));
    const rows = l.view.pickable();
    const first = at ? (at === "first" ? rows[0] : rows.at(-1)) : l.view.picked(PERSON) ?? l.view.visible().find(selectable);
    if (first) this.selectListRow(l, first.id, first.group);
  }

  /** Out of the list the person is in (any, or only `key`): its typed filter goes with it. */
  leaveList(key?: string) {
    const was = this.listIn;
    if (!was || (key && key !== was)) return;
    this.modes.drop("list");
    this.listViews.get(was)?.stopTyping(false);
  }

  /** A list action (list.pick, list.open, …), through the host's dispatcher, else the reader's own. */
  runList<K extends ListActionName>(name: K, args: ArgsOfSet<typeof LISTVIEW_ACTIONS>[K], host: SurfaceHost, quiet: boolean | ((why: string) => string | null) = false): Promise<unknown> {
    return host.pressSet ? host.pressSet(LISTVIEW_ACTIONS, name, args as Record<string, unknown>, quiet, host) : this.alone(host).pressIn(LISTVIEW_ACTIONS, name, args as Record<string, unknown>, undefined, quiet);
  }

  listHost(host?: SurfaceHost): ListHost {
    const here = () => { if (!host) throw new ActionRefused("this list action needs the reader's host"); return host; };
    return {
      lists: () => this.listsDrawn.map(list => ({ ...list, entered: this.listIn === list.key })),
      current: () => {
        const link = this.selectedElement()?.link;
        return this.listIn ?? link?.listRow?.key ?? (link?.inlineList && this.inlineLists.get(link.inlineList.key)?.rows.find(r => r.target.listRow)?.target.listRow?.key) ?? null;
      },
      none: "this note draws no list (a ::links component, or an extension's list view)",
      picked: (l, row) => { this.selectListRow(l, row.id, row.group); const target = listOpenTarget(row); return this.previewRow(here(), target ? { ...target, listRow: { key: l.key, row: row.id, group: row.group } } : undefined); },
      open: (l, row, where, actor, standing) => this.openListRow(l, row, where, actor, here(), standing),
      enter: (l, on) => { if (on || this.listIn === l.key) { this.enterList(l, on); if (!on) here().retirePeeks?.(USER); } },
      // Typing a filter is the one mode a collection has: the letters are its until ⏎ keeps or esc clears them (list-mode.ts).
      type: l => { if (this.listIn !== l.key) { this.enterList(l, true); if (l.collection) this.modes.push(listMode(this, l.key, l.title)); } l.view.startTyping(filterLine); },
      tune: (l, actor, standing) => this.run("settings", { list: l.key }, here(), actor, standing),
      choose: (l, action, keys) => here().overlay?.(listFieldPicker(l.title, action, keys, by => { void this.runList(action, { list: l.key, by }, here()); })),
      inView: l => { const d = this.drawn, v = this.viewport(), win = [...this.inlineLists.values()].map(i => i.shown(l.key)).find(Boolean), at = (e: Element) => `${e.link!.listRow!.row}|${e.link!.listRow!.group ?? ""}`; return d && v ? this.elems.filter(e => e.link?.listRow?.key === l.key && e.link.listRow.row && (!win || win.has(at(e))) && e.row - d.top >= v.top && e.row - d.top + (win?.get(at(e)) ?? 1) <= v.top + v.room).map(e => ({ id: e.link!.listRow!.row!, group: e.link!.listRow!.group })) : undefined; }, redraw: () => host?.redraw(),
    };
  }

  /** An agent's row may be outside the person's answer, so follow its target without needing a drawn element. */
  private async openListRow(l: ListHandle<any>, row: ListViewRow<any>, where: "home" | "new", actor: Actor, host: SurfaceHost, standing: boolean): Promise<unknown> {
    const target = listOpenTarget(row);
    if (target) {
      const asked = this.askLeave("list.open", { list: l.key, id: row.id, where }, actor, host);
      if (asked) return asked;
      // The person's open is on their [ ] position, as ⏎ on the row's element is (PIE-1556); an agent's leaves it.
      if (standing) this.selectListRow(l, row.id, row.group);
      const result = await this.followTarget(target, { ...host, actor }, { link: true, fresh: where === "new", by: actor, standing });
      this.noteAgent(actor, `opened ${row.label}`);
      host.redraw();
      return result && "id" in result ? { opened: result.id, title: subject(result) } : result;
    }
    const at = this.linkRowElement(l.key, row.id, row.group);
    if (!at) throw new ActionRefused(`${row.label} isn't drawn in ${l.title} now`);
    // A row that runs an action line is a press (button.press), as whoever asks.
    if (at.e.link?.press) return NOTE_ACTIONS.run("button.press", { n: at.n }, { surface: this, host, standing }, actor);
    return NOTE_ACTIONS.run("element.open", { n: at.n, ...(at.row !== undefined ? { row: at.row } : {}), ...(where === "new" ? { fresh: true } : {}) }, { surface: this, host, standing }, actor);
  }

  // ── more modes: the open choice, leaving an unsent comment, moving the composer (PIE-785) ────
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
      hint: () => p.kind === "callout" ? `callout type · ${hintOf([...chooseKeys("callout.type").slice(0, 3), rk("-", "callout.start", "start folded", { folded: true }), rk("+", "callout.start", "start open"), ...chooseKeys("callout.type").slice(3)])}`
        : `status · ${hintOf([...STEP_CHOICES.map(c => rk(c.key, "task.status", c.id === "copy-link" ? "copy link" : c.id === "address" ? "addressable" : statusWord(c.id), { status: c.id })), ...chooseKeys("task.status")])}`,
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
    const then = ask.name === "list.open" ? await this.runList(ask.name, ask.args as never, host)
      : await this.runKey(ask.name, (n ? { ...ask.args, n } : ask.args) as never, host);
    return { choice, ...(said ? { said } : {}), then };
  }

  /** ctrl+g in a comment being written: its box floats, and the arrows move it and shift+arrows size it until ⏎ or esc (PIE-785). */
  gripMode(cs: { place: AttachedPlace; float: FloatRect | null; mode?: string }, target: AttachmentKind = "comment"): GripMode {
    const { actions } = this.attachments.def(target);
    const move = (args: ComposerMove, host: SurfaceHost) => void this.runKey(actions.move as keyof NoteActionArgs, args as never, host, true);
    const side = (to: AttachedSide, host: SurfaceHost) => void this.runKey(actions.place as keyof NoteActionArgs, { place: "tile", side: to } as never, host, true);
    const tiled = () => cs.place === "tile";
    return {
      name: "grip", of: cs, ...(target === "comment" ? { over: cs } : {}), holdsKeys: true, word: "composer move",
      editing: () => false, covers: () => false,
      ended: () => (cs.place === "tile" ? false : (target === "comment" && cs.mode !== "compose") || cs.place !== "floating"),
      key: (k, host) => {
        const c = ch(k);
        // An arrow or h j k l: its side; shifted, or H J K L, it sizes instead (a float only).
        const dir = k.kind === "left" || c === "h" ? "left" : k.kind === "right" || c === "l" ? "right" : k.kind === "up" || c === "k" ? "up" : k.kind === "down" || c === "j" ? "down" : null;
        const sized = c === "H" ? "left" : c === "L" ? "right" : c === "K" ? "up" : c === "J" ? "down" : null;
        const done = k.kind === "enter" || k.kind === "esc" || (k.kind === "char" && k.ctrl && k.ch === "g");
        // In its own tile (PIE-846): the arrows put it on that side of its reader; its border sizes it (or ^W < > + -).
        if (tiled()) {
          if (dir) side(dir, host);
          else if (done) { this.modes.drop("grip"); host.redraw(); }
          else { this.modes.drop("grip"); return this.modes.key(k, host) ?? false; }
          return true;
        }
        const by = { left: [-2, 0], right: [2, 0], up: [0, -1], down: [0, 1] } as const;
        const shift = "shift" in k && !!k.shift;
        if (dir) move(shift ? { dcols: by[dir][0], drows: by[dir][1] } : { dx: by[dir][0], dy: by[dir][1] }, host);
        else if (sized) move({ dcols: by[sized][0], drows: by[sized][1] }, host);
        else if (c === "0") move({ reset: true }, host);
        else if (done) { this.modes.drop("grip"); host.redraw(); }
        else { this.modes.drop("grip"); return this.modes.key(k, host) ?? false; }
        return true;
      },
      click: () => { this.modes.drop("grip"); return undefined; },
      rows: () => null,
      leave: async () => { this.modes.drop("grip"); return { left: "nothing" }; },
      hint: () => (`${tiled() ? "moving the attachment round its note" : "moving the attachment"} · ${hintOf(gripKeys(tiled()))}`),
      state: () => "moving the comment",
      describe: () => ({ moving: true, float: cs.float }),
    };
  }

  /** Open moving by keys (ctrl+g, comment.grip): the box floats first if it was elsewhere. */
  grip(host: SurfaceHost) {
    const cs = this.session;
    if (!cs || ((cs.mode !== "compose" || !cs.composer) && cs.place !== "tile")) throw new ActionRefused(NO_COMMENT);
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
    if (!cs || cs.mode !== "compose" || !cs.composer) throw new ActionRefused(NO_COMMENT);
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
  private dragFrame(g: Extract<ReaderGesture, { kind: "frame" }>, x: number, y: number, host: SurfaceHost) {
    const f = g.from, dx = x - g.x, dy = y - g.y;
    const to = g.zone.kind === "move" ? { row: f.row + dy, col: f.col + dx, cols: f.cols, rows: f.rows }
      : { row: f.row, col: f.col, cols: f.cols + (g.zone.cols ? dx : 0), rows: f.rows + (g.zone.rows ? dy : 0) };
    const o = this.attachments.def(g.target).owner(), now = o?.float ?? o?.frame ?? (g.target === "comment" ? this.boxRect : null);
    if (now && now.row === to.row && now.col === to.col && now.cols === to.cols && now.rows === to.rows) return;
    void this.runKey(this.attachments.def(g.target).actions.move as keyof NoteActionArgs, { ...to, ...this.attachments.def(g.target).args } as never, host, true);
  }

  // ── the comment or edit being written: its keys, clicks, tile and pointer (PIE-846) ────
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

  /** The comment session's keys: its commands are actions (PIE-506); picking, moving and typing are its own. comment.escape (esc, its own row) is the composer's edit.close key, wherever the keymap put that. */
  commentEscape(host: SurfaceHost) { const s = this.session; return s ? asHintEsc(() => this.commentKey(s, { kind: "esc" }, host, true)) : false; }

  private commentKey(s: CommentSession, k: Key, host: SurfaceHost, escape = false): boolean {
    if (!escape && s.mode === "compose" && s.composer && !s.busy && !s.composer.busy && !completerOf(s.composer)?.shown) {
      const binding = modeBinding(COMMENT_KEYS, k), stray = binding?.action === "comment.escape" && !s.composer.closesBy(k);   // edit.close moved: esc is stray (PIE-1688)
      if (binding && !stray) { void this.runKey(binding.action as keyof NoteActionArgs, binding.args as never, host, true); return true; }
    }
    const writing = s.writing;
    // Back to writing: a "leave it unsent?" asked in the power bar (PIE-785) is over, and its answer does nothing.
    this.leaving = null;
    // cmd+c in the comment being written copies its selection (the draft's copy, as in an edit).
    if (s.mode === "compose" && s.composer && isCopyKey(k)) { void this.runKey("draft.copy", {}, host); return true; }
    // ctrl+o: the composer somewhere else (inline, floating, split, popup: PIE-770); the thread list into its own tile
    // beside the note and back over it (PIE-846).
    if (s.mode !== "compose" && !s.busy && modeBinding(COMMENT_KEYS, k)?.action === "comment.place" && host.attachedTile) { void this.runKey("comment.place", { place: s.place === "tile" ? "inline" : "tile" }, host, true); return true; }
    if (s.mode !== "compose" && s.place === "tile" && !s.busy && modeBinding(COMMENT_KEYS, k)?.action === "comment.grip") { void this.runKey("comment.grip", {}, host, true); return true; }
    // Typing brings an inline composer (rows of the note) back into view after the wheel took the note elsewhere. A
    // floating, split or popup one is in view already: the note stays where it was scrolled (PIE-846).
    if (s.mode === "compose" && s.place === "inline") { this.revealComposer = true; this.composerAsked = this.scroll; }
    const verb = s.mode === "threads" && !s.busy && s.threads[s.sel] ? ATTENTION_KEYS[ch(k) ?? ""] : undefined;
    if (verb) { void this.runKey(verb, { thread: s.threads[s.sel]!.id, ...(ch(k) === "T" ? { remove: true } : {}) }, host, true); return true; }
    // e edits the current thread's comment in the same editor (PIE-763); a reply's words: its [Edit] on the expanded thread.
    if (s.mode === "threads" && !s.busy && s.threads[s.sel] && ch(k) === "e") { void this.runKey("comment.edit", { thread: s.threads[s.sel]!.id }, host, true); return true; }
    // q quotes the current thread (or the ones space picked) into a new block; space picks.
    if (s.mode === "threads" && !s.busy && s.threads[s.sel] && ch(k) === "q") { void this.runKey("quote", {}, host, true); return true; }
    if (s.mode === "threads" && !s.busy && s.threads[s.sel] && ch(k) === " ") { void this.runKey("thread.pick", {}, host, true); return true; }
    if (s.key(k, this.commentEnv(host)) === "close" || s.done) void this.runKey("comment.close", {}, host);
    // A comment closed by esc, esc is put aside, like an edit: said where, and how it comes back.
    if (k.kind === "esc" && writing && s.writing !== writing) host.ctx.flash(writing.closedWith || "closed the comment", 8000);
    host.redraw();
    return true;
  }

  /** A click in text being written (an edit's or a comment's): a completion candidate, the preview control, or the cursor placed. */
  private writeClick(d: Draft, x: number, y: number, host: SurfaceHost): boolean {
    if (d.busy) return false;
    const p = this.editPreview.rect;
    if (d === this.draft && d.views.raw.preview && (this.editPreview.place !== "tile" || host.attachment === "edit-preview") && p && x >= p.col && x < p.col + p.cols && y >= p.row && y < p.row + p.rows) {
      if (y === p.row) void this.runKey("placement.menu", { target: "edit-preview" }, host, true);
      else { const link = d.views.raw.frame?.links?.find(l => l.row === y && x >= l.from && x < l.to); if (link) { const ref = refOfLink(link.target); if (ref) void this.runKey("edit.follow", { ref }, host); } }
      return true;
    }
    if (completerOf(d)?.click(y, x, text => host.ctx.copy?.(text, "component preview"))) return true;
    // Beside a composer's box (floating, popup, split: PIE-770) a click is nobody's: not a candidate, not the cursor.
    const f = d.views.raw.frame;
    if (f && (x < f.col - 1 || x > f.col + f.cols)) return false;
    if (completionOf(d)) return false;
    const follow = (to?: Link) => { const ref = to && refOfLink(to); if (!to || ref) void this.runKey("edit.follow", ref ? { ref } : {}, host); };
    const placed = editorClick(d, x, y, false, USER, { pick: () => void this.runKey("draft.pick", {}, host), copy: () => void this.runKey("draft.copy", {}, host), place: () => void this.runKey("placement.menu", { target: "comment" }, host, true), lands: () => void this.runKey("note.move", {}, host, true), follow, ...(d === this.draft ? { fold: (line: number) => void this.runKey("fold.toggle", { line }, host) } : {}) }, host.freshClick ? 8 : 0, d !== this.draft || this.editPreview.place !== "tile");
    if (placed) host.redraw();
    return placed;
  }
  /**
   * Follow link `l` from the edit or comment being written (`edit.follow`, PIE-592): where a reader's link opens, which
   * for a reader holding an edit is beside it (the desk's `besideEdit`); the draft and its cursor stay as they were.
   */
  followFromDraft(l: Link, host: SurfaceHost): Promise<Msg | Outside | TagList | SoftChoices | null> {
    return this.followTarget(l, host, { link: true });
  }
  /** The draft being written here, an edit's or a comment's, or null. */
  get writingDraft(): Draft | null {
    return (this.drafting ?? (this.session?.mode === "compose" ? this.session.writing : null) ?? this.listEditor.field?.session)?.draft ?? null;
  }

  /**
   * The comment being written as its own tile draws it (PIE-846, place `tile`): the one edit control (renderEditor) in
   * the tile's `w` × `h` cells, the passage quoted above the text as split and popup quote it, its preview's pictures
   * placed. Null when nothing is being written here in a tile.
   */
  private composerTile(w: number, h: number, host: SurfaceHost): SurfaceView | null {
    const cs = this.session;
    if (!cs || cs.place !== "tile" || !this.msg) return null;
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
    return { lines, completion: completerOf(c.d) ?? undefined, placements: previewPictures(c.d, 0, h) };
  }

  /** Attachment `kind` in a tile of its own (PIE-846, PIE-1448), `w` × `h`: null when it isn't in one. */
  attachedView(kind: AttachmentKind, w: number, h: number, host?: SurfaceHost): SurfaceView | null {
    const v = this.attachments.tile(kind, w, h, host);
    return v && this.withPlacementMenu(v, w, h, kind);
  }

  /**
   * The kinds attached to the note (PIE-1536): each one's state, drawing and words. Where they sit, which is on top,
   * their splits and their tiles are the layer's (attachments.ts).
   */
  private attachmentKinds(): AttachmentDef<SurfaceHost, SurfaceView>[] {
    const surface = this;
    const chipOf = (r: FloatRect | null, place: AttachedPlace) => r && { col: r.col + r.cols - width(`[${place} ▸]`), row: r.row };
    const card = () => this.panel?.card ?? null, sm = () => this.sourcesMode;
    return [{
      kind: "comment", get noun() { return surface.session?.mode === "threads" ? "comments" : "comment"; },
      // The session keeps its own placement; the layer never floats it (its box is placed by its passage: overComposer).
      owner: () => this.session as unknown as AttachedState | null, shown: () => false, mode: "comment",
      draw: (w, h, _row, _col, host) => host ? this.composerTile(w, h, host) : null,
      holdsKeys: () => true, tileKeys: () => this.session?.startedBy.kind === "user",
      actions: { place: "comment.place", move: "comment.move" }, closed: NO_COMMENT,
      chip: () => {
        const control = (this.session?.composer ? this.session.composer.views.raw.frame : null)?.controls.find(c => c.action === "place");
        if (!control) throw new ActionRefused("write a comment in a reader at least 28 columns wide to show its placement chip");
        return { col: control.from, row: control.row + (this.session?.place === "tile" ? 0 : this.heroTop) };
      },
      // The thread list (m) goes into its tile beside the note and back over it (PIE-846); a comment anywhere.
      refuse: (want, _side, asked) => this.session?.mode !== "compose" && asked !== undefined && want !== "tile" && this.session?.place !== "tile" ? "the thread list is drawn over the note, or in its own tile beside it: place=tile" : null,
      placed: (_want, host) => { if (this.sourcesMode) this.focusSources(host, false); this.revealComposerNext(); },
      move: (a, host) => this.moveComposer(a, host),
    }, {
      kind: "sources", noun: "sources", owner: sm, mode: "sources", min: { cols: 24, rows: 10 }, persist: "sources-place.json",
      fit: (cols, rows, fill) => ({ cols: fill ? cols : drawSources(sm()!.panel, cols - 2, Date.now()).cols + 2, rows }),
      draw: (cols, rows, row, col) => this.renderSources(cols, rows, row, col),
      holdsKeys: () => !!sm() && this.modes.active(sm()!), tileKeys: () => true,
      actions: { place: "sources.place", move: "sources.move" }, closed: "S opens the Sources inspector",
      chip: () => chipOf({ col: sm()!.rect.x, row: sm()!.rect.y, cols: sm()!.rect.w, rows: sm()!.rect.h }, sm()!.place),
      placed: (want, host, _side, was) => { sm()!.reveal = true; if (was === "tile" && want !== "tile") this.focusSources(host, true); },
    }, {
      kind: "settings", noun: "settings", owner: card, mode: "panel", persist: "settings-place.json",
      draw: (cols, rows, row, col) => this.renderSettings(cols, rows, row, col),
      holdsKeys: () => { const m = this.modes.get("panel"); return !!m && this.modes.active(m); }, tileKeys: () => true,
      actions: { place: "settings.place", move: "settings.move" }, closed: ", opens settings first",
      chip: () => chipOf(card()!.rect, card()!.place),
      placed: (_want, host) => { this.attachedKeys("settings"); host.enterMode?.(); },
    }, {
      // Its placement is kept while no list is selected: it's where the next preview goes.
      kind: "list-preview", noun: "list children", owner: () => this.listPreview, mode: "list-preview", splitRows: 12, persist: "list-preview-place.json",
      // A comment or an edit, a floating card or Sources beside the note, or the select wire's own preview tile take its place.
      shown: host => !!this.previewPoint() && !this.draft && !this.session && !host?.hasWiredPreview?.()
        && !(card() && card()!.place !== "inline" && card()!.place !== "tile") && !(sm() && sm()!.place !== "tile"),
      tileOwner: host => (this.previewPoint() && !host?.hasWiredPreview?.() ? this.listPreview : null),
      draw: (cols, rows, row, col, host) => this.listPreviewView(cols, rows, host, row, col),
      holdsKeys: () => false, tileKeys: () => false,
      actions: { place: "list.preview.place", move: "list.preview.move" }, closed: "select an item in a preview list first",
      chip: () => chipOf(this.listPreview.rect, this.listPreview.place),
    }, {
      kind: "edit-preview", noun: "edit preview", owner: () => (this.draft && this.draft.views.raw.preview ? this.editPreview : null), shown: () => false, mode: "draft",
      min: { cols: 30, rows: 6 }, split: { direction: "down", share: .5 }, persist: "edit-preview-place.json",
      draw: (cols, rows, row, col, host, where) => host ? this.editPreviewRows(cols, rows, row, col, host, where === "split" && col > 0) : null,
      holdsKeys: () => false, tileKeys: () => false,
      actions: { place: "edit.preview.place", move: "edit.preview.move" }, closed: "ctrl+p shows the edit preview first",
      chip: () => chipOf(this.editPreview.rect, this.editPreview.place),
      // Below the draft is a split under it, half and half.
      placed: want => { if (want === "inline") this.attachments.splits["edit-preview"] = { direction: "down", share: .5 }; },
    }];
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
    if (k.action === "down") {
      d.holdFolds(); const n = d.clicks.press(x, y), placed = this.writePress(d, x, y, false);   // what's drawn stays until the release
      this.pointer.hold({ kind: "draft", placed, shift: false, kept: null, selecting: placed && n > 1 ? selectClicks(d, n, (action, args) => this.runKey(action as never, args as never, host)) : null });
      host.redraw(); return true;
    }
    if (k.action === "drag") { if (this.pointer.draft) { d.clicks.drag(x, y); this.writePress(d, x, y, true); host.redraw(); } return true; }
    if (k.action === "up") {
      const g = this.pointer.take(), r = d.clicks.release(x, y);
      if (r.click) this.writeClick(d, x, y, host);
      else if (r.copy) void ((g?.kind === "draft" ? g.selecting : null) ?? Promise.resolve()).then(() => { if (d.selectedText()?.trim()) void this.runKey("draft.copy", {}, host); host.redraw(); });
      d.letFoldsGo(); host.redraw();
      return true;
    }
    return false;
  }

  /** A press puts the cursor there; a drag from it selects (Draft's own selection). */
  private writePress(d: Draft, x: number, y: number, drag: boolean, host?: SurfaceHost): boolean {
    if (completerOf(d)?.previewPress(x, y, drag)) return true;
    const p = d === this.draft && d.views.raw.preview && (this.editPreview.place !== "tile" || host?.attachment === "edit-preview") ? this.editPreview.rect : null;
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
    const h = this.hitAt(x, y - this.heroTop);
    return !!h && "link" in h && (h.link.role === "task" || h.link.role === "callout");
  }

  // ── hit tests: what's under a cell ───────────────────────────────────────────
  /**
   * A right-click at the surface's cell `x`, `y` on a button: element.select makes it the `[ ]` position and nothing runs,
   * so the tile menu that opens there is about it (its "pin to status bar", PIE-1415). Null anywhere else.
   */
  pointAt(x: number, y: number, host: SurfaceHost): Promise<unknown> | null {
    const h = this.hitAt(x, y - this.heroTop), i = h && "link" in h && h.link.press && h.elem ? this.elems.findIndex(el => el.key === h.elem) : -1;
    return i < 0 ? null : this.runKey("element.select", { n: i + 1 }, host);
  }

  hoverAt(x: number, y: number): { target?: LinkTarget; collection?: ListView; rect: { col: number; row: number; cols: number; rows: number } } | null {
    const h = this.hitAt(x, y - this.heroTop);
    const point = h && "link" in h && (h.link.block || h.link.page) ? { target: h.link, rect: { col: h.from, row: h.row + this.heroTop, cols: h.to - h.from, rows: 1 } } : null;
    for (const l of this.listsDrawn.filter(l => l.collection)) {
      const hits = this.hits.filter(h => "link" in h && h.link.listRow?.key === l.key);
      const col = Math.min(...hits.map(h => h.from)), row = Math.min(...hits.map(h => h.row)) + this.heroTop;
      const cols = Math.max(...hits.map(h => h.to)) - col, rows = Math.max(...hits.map(h => h.row)) + this.heroTop - row + 1;
      if (x >= col && x < col + cols && y >= row && y < row + rows) return { ...point, collection: l.view, rect: point?.rect ?? { col, row, cols, rows } };
    }
    return point;
  }

  /** What the last render put at cell `x`, `y`; a region's mark covers a fold at the same gutter cell. */
  hitAt(x: number, y: number): Hit | undefined {
    return pickTarget(this.hits.filter(h => h.row === y && x >= h.from && x < h.to));
  }

  // ── keys: each one is an action, the same ones an agent calls ─────────────

  key(k: Key, host: SurfaceHost): boolean {
    this.use(host);
    if (k.kind === "esc") return escPress(READER_ESC, readerEscSteps(this as never, host));
    // A step's status choice, the property panel, the edit or the comment: the first open one takes the key.
    const taken = this.modes.key(k, host);
    if (taken !== null) return taken;
    const c = ch(k);
    // An extension's line that is the current element (PIE-512): a key its actions answer to runs that
    // action (`w` wards); the reader's own keys stay the reader's (READER_OWN_KEYS, read from READER_KEYS).
    const xe = c ? this.inView()?.link?.ext : undefined;
    const xa = xe ? handlerKeyAction(xe.extension, xe.handler, c, host.ownKeys) : undefined;
    if (xe && xa) { void this.pressExt(xa.name, xe, host); return true; }
    // The current element's own keys first: a selection's (PIE-419: v y Y cmd+c, esc), a collection row's (PIE-1501),
    // a figure's, an image's (PIE-532).
    if ((c === "v" || c === "y" || c === "Y" || isCopyKey(k) || this.selection) && this.msg && this.selectKey(k, host)) return true;
    if (collectionKey(this, k, host)) return true;
    const ek = this.figureKey(k) ?? this.imageKey(k);
    if (ek) { void this.runKey(ek.name, ek.args as never, host); return true; }
    const row = readerBinding(k, g => this.holds(g, host)); // then the reader's own (READER_KEYS): the first row whose guards hold
    if (!row) { if (READER_SAYS[c]) { host.ctx.flash(READER_SAYS[c]!); return true; } return false; }
    if (row.start) {
      // e and ctrl+e arm the edit first (edit.arm): ⏎ or the key again opens it.
      if (armsEdit(row.start)) { void this.runKey("edit.arm", (row.args ?? {}) as never, host); return true; }
      // The edit and the comment say their own refusals (a flash, the draft's note); the panel's are said here.
      const starts = row.start;
      void this.startAsPerson(starts, host).catch(e => { if (starts === "props" || starts === "props-full") host.ctx.flash(e instanceof Error ? e.message : String(e), undefined, errorDetails(e)); host.redraw(); });
      return true;
    }
    if (row.pick) return this.pickKey(row, k, host);
    // A row of the person's keymap carries its arguments as words, as `act` does: typed as the wire's are (a refusal is said).
    try { void this.runKey(row.action as keyof NoteActionArgs & string, (READER_KEYS.includes(row) ? row.args ?? {} : coerceActionArgs(row.action, NOTE_ACTIONS.argsOf(row.action) ?? {}, row.args ?? {})) as never, host, !!row.quiet); } catch (e) { host.ctx.flash(e instanceof Error ? e.message : String(e)); }
    return true;
  }

  /** What the next Esc closes in this reader, in the hint's words, or null. */
  escNext(host: SurfaceHost): string | null { return escNext(READER_ESC, readerEscSteps(this as never, host)); }
  /** Whether reader guard `g` holds now (READER_GUARDS says each in words). */
  private holds(g: ReaderGuard, host: SurfaceHost): boolean {
    const m = this.msg;
    switch (g) {
      case "note": return !!m;
      case "whole": return !!m && !m.partial;
      case "outline": return !!m && isOutlineNote(m);
      case "parent": return !!m?.parentId;
      case "preview": return host.attachment === "list-preview" && !!this.previewPoint();
      // R on a line that runs fetches it again, as its hint says (PIE-1668); a proposal elsewhere in view waits for R off it.
      case "resolvable": return !this.runsAtCurrent() && !!this.resolveTarget();
      case "proposal": return !!m && (isOpenProposal(m) || !!this.currentProposal());
      case "element": return !!this.cur || !!this.pendingLink;
      case "tinted": return !!this.focusMark;
      case "zoomed": return !!this.zoom;
      case "settings": return !!m && !!this.settingsSchemaOf(m);
      case "task": { const e = this.inView(); return e?.kind === "task" && !!e.task; }
      case "detach": return !!host.detach;
    }
  }

  /** A row whose action the reader picks at the key (ReaderPick): what's in front of it decides. */
  private pickKey(row: ReaderKey, _k: Key, host: SurfaceHost): boolean {
    switch (row.pick!) {
      case "page": void this.runKey("scroll", { by: this.pageBy((row.args?.by as number) < 0 ? -1 : 1) }, host); return true;
      case "fold-all": void this.runKey(this.folded.size === 0 ? "fold" : "unfold", { all: true }, host); return true;
      case "task": { const e = this.inView()!; void this.runKey("task.status", { to: stepClosed(e.task!.step.status) ? "todo" : "done" }, host, true); return true; }
      case "detach": host.detach!(); return true;
      case "undo": return this.undoKey(host);
      case "enter": return this.enterKey(!!row.args?.fresh, host);
      case "resolve": {
        // With several proposals in view, none current and none named by the binding, the key asks which (PIE-1533): [ ] goes to one's [resolve], the key again resolves it.
        const t = row.args?.block || row.args?.id ? null : this.resolveTarget();
        if (t && "several" in t) { this.setElem(t.first); host.ctx.flash(`${t.several.length} proposals in view · ${row.key} again resolves this one · ] then ${row.key} offers the next`); host.redraw(); return true; }
        void this.runKey("proposal.resolve", (row.args ?? {}) as never, host);
        return true;
      }
    }
  }

  /** ctrl+z undoes the last change made here, a step's status, a callout's header or an image's layout, whichever came last. */
  private undoKey(host: SurfaceHost): boolean {
    const at = this.msg?.id ?? "";
    if (at && hasStrays(`edit:${at}`)) { void this.runKey("edit.strays", {}, host); return true; }   // esc's dropped strays (src/stray.ts) first
    // The newest change of this note's journal, whatever its kind (undo-journal.ts); settings' scope is read beside it.
    const newest = newestUndo("you", at), last = { name: (newest?.via ?? "task.undo") as "task.undo", seq: newest?.seq ?? -1 };
    // A note trashed after it comes back first (note.untrash). The layout isn't compared (PIE-1435): a tile moved elsewhere
    // didn't happen to this note, so the desk's ctrl+z (layout.undo, or a trash newer than it) gets the key only when the
    // reader has nothing of its own; with no layout change either, the reader's refusal says there's nothing to undo.
    const trashedAt = lastTrashed(host.ctx.board, USER)?.seq;
    if (trashedAt !== undefined && trashedAt > last.seq) {
      return last.seq >= 0 && !!host.untrash?.(host.ctx.board);
    }
    if (last.seq < 0 && host.layoutUndoSeq?.() !== undefined) return false;
    if (!newest) { host.ctx.flash(NOTHING_TO_UNDO); return true; }   // nothing of any kind: the key's answer, not task.undo's (steps only)
    void this.runKey(last.name, {}, host, true);
    return true;
  }

  /**
   * ⏎ acts on the current element while the person can see it: a link follows (where is the host's call), a fold toggles,
   * a row or an embed opens its note, a comment mark its thread. alt+⏎ opens a link, a row or an embed in a new reader.
   * Otherwise ⏎ isn't the reader's.
   */
  private enterKey(fresh: boolean, host: SurfaceHost): boolean {
    if (!fresh && this.selectedFold()) { void this.runKey("fold.toggle", {}, host); return true; }
    // The one reading position answers (card 10): the current element, else (nothing current, no link waiting to be
    // drawn) the ::button on the reading line (j k, PIE-1518): ⏎ presses it, no ] first.
    const e = this.inView() ?? (this.pendingLink ? null : this.buttonAtReading());
    if (e) {
      if (fresh && !opens(e) && !e.link?.press?.alt) return false;
      void this.activate(e, host, fresh);
      return true;
    }
    // The position is a link selected before its element was laid out (link.select, then ⏎ before a paint): it follows.
    if (this.pendingLink) { void this.runKey("link.follow", fresh ? { fresh } : {}, host); return true; }
    return false;
  }

  /**
   * The one activation (PIE-1556): ⏎ on the current element, a click on any element's target and `act` all end in the
   * same action on it, by its number: a button's (or a view square's) press, else element.open, which decides by the
   * element's kind (a link follows, a fold toggles, a step opens its choice, a proposal's control runs). `fresh`: alt+⏎,
   * an alt-, ctrl- or middle-click: a new reader for what opens one, a press's alt= action.
   */
  private activate(e: Element, host: SurfaceHost, fresh = false): Promise<unknown> {
    const n = this.elems.indexOf(e) + 1;
    if (e.link?.press) return this.runKey("button.press", { n, ...(fresh ? { alt: true } : {}) }, host);
    return this.runKey("element.open", { n, ...(fresh && opens(e) ? { fresh: true } : {}) }, host);
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
      tiles: () => [{ name: me, ...(host.tileId?.() ? { id: host.tileId()! } : {}), kind: "reader", shows: this.msg?.id ?? null, editing: this.editing, holds: a => this.heldBy(a) }],
      draftOf: () => ({ board: host.ctx.board, blockId: this.msg?.id ?? null, session: this.draftSession() }),
    }, [
      { set: NOTE_ACTIONS, takes: "tile", noun: "a reader", on: (_, how) => ({ surface: this, host, standing: how.standing }), run: (name, args, on, actor, typed) => this.run(name, args, host, actor, on.standing, typed) },
      { set: LISTVIEW_ACTIONS, takes: "tile", noun: "a list", on: (_, how) => ({ host: this.listHost(host), standing: how.standing }) },
    ]);
  }

  // ── extension lines and buttons: running what a line or a press names (PIE-512) ────
  /**
   * An extension line's action as the person (a key, a click, ⏎ on its head or a control): the line's own action
   * (EXT_ACTIONS), or `R` (run it again, ask the agent again) through projection.refresh.
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
  async runPress(p: NonNullable<Link["press"]>, host: SurfaceHost, actor: Actor, repick = false, press: Press = { tile: messageContext.getStore()?.tile, note: p.block || undefined, actor }, alt = false): Promise<unknown> {
    const d = host.ctx.dispatch;
    if (!d) throw new ActionRefused("this screen has no dispatcher to run a press");
    const run = async () => {
      const note = p.block ? await host.ctx.board.get(p.block) : null;
      // `alt`: the press runs the button's alt= (PIE-1316): its own line and its own open slots.
      const button = note ? buttonPressed(note.text, p, this.draft?.blockId === note.id ? this.draft.text : undefined) : null, own = alt ? button?.alt : button?.act; // where it is now (PIE-1693): saved, else in this reader's open edit (PIE-1699)
      if (own && button!.slots.some(s => p.act.includes(`{${s.key}}`))) p = { ...p, act: own }; // a slot filled since the frame this press came from (PIE-1570)
      // A button that reads differently than it was written runs nothing (it never acts on the focused tile instead); one with an
      // empty slot asks for it, and alt+click on a button with slots (and no alt= of its own) asks again (PIE-1298).
      if (button?.problem && button.act === null) throw new ActionRefused(`the ::button on line ${button.line + 1} runs nothing: ${button.problem}`);
      const open = alt ? button?.altEmpty ?? [] : button?.empty ?? [];
      if (button && note && (open.length || (repick && button.slots.length))) return this.askSlots(note.id, button, repick ? button.slots.map(s => s.key) : open, host, actor, !repick, alt);
      if (button?.sequence && p.act === button.act) {
        // Its first step refused now (no tile it names, PIE-1418): said before anything runs, in the presser's words.
        const first = sequenceStart(button), no = first ? d.refusedNow(d.requestIn(actRequestOf(lineWords(first)), press), actor) : null;
        if (no) throw new ActionRefused(`${button.label} can't run here: ${no}`);
        const invitation = INVITES.pressed(press);
        const r = await host.ctx.board.request("scripts.sequence", {
          blockId: note!.id, line: button.line, clientId: host.ctx.board.clientId, invitation, mutation: mutationFor(actor),
        });
        if (invitation && r.undo) INVITES.bind(invitation, r.undo);
        if (r.undo) EXT_UNDO.push({ undo: r.undo, label: button.label, by: partyOf(actor), context: note!.id });
        host.redraw();
        // The step that stopped it, in its own words, to an agent (PIE-1264); the person hears it from `scripts.ended`.
        if (r.state === "failed" && actor.kind !== "user") throw new ActionRefused(r.message ?? `${button.label} failed`);
        return r;
      }
      let req;
      try { req = actRequestOf(lineWords(p.act), { repeats: "list" }); } catch (e) { throw new ActionRefused(`${p.act}: ${e instanceof Error ? e.message : String(e)}`); }
      if (req.as !== undefined) throw new ActionRefused(`${p.act}: a press runs as ${actor.kind === "user" ? "you" : "its presser"}; leave out as=`);
      const args: Record<string, unknown> = { ...(req.args ?? {}) };
      let action = req.action;
      if (!d.takes(d.requestIn(req, press))) {
        const { listed, scripts } = await this.scriptsNamed(action, p.block || this.msg?.id, p.line, host);
        if (!scripts.length) {
          throw new ActionRefused(installWords(action, listed.available) ?? d.unknownAction(action));
        }
        if (scripts[0]!.state === "failed") throw new ActionRefused(scripts[0]!.error!);
        if (scripts.length > 1) host.ctx.flash(scripts[0]!.description ?? "");
        const run = scripts[0]!.actions.find(a => a.id === "run");
        // A `[mode::module]` note is only imported: it has nothing to press.
        if (!run) throw new ActionRefused(`${action} is a module (imported by other scripts); it has no run`);
        action = run.name;
      }
      // An extension's action acts on a note: the one this press is written in, unless the line names another.
      if (EXT_ACTIONS.has(action) && args.block === undefined) args.block = p.block || this.msg?.id;
      // The person's press of a script is invited by the script's action itself (extensions.ts, lineAction). Any press names
      // its button (via), so the run's note records it and the run reads its slots whole (`page=a page=b`).
      if (scriptActions().some(s => s.action.name === action) && (args.invitation ??= INVITES.pressed(press))) {
        const home = p.block || this.msg?.id;
        if (home) args[PRESSED_VIA] ??= `${home}:${button?.line ?? p.line}`;
      }
      const result: unknown = await d.act(d.requestIn({ action, args, ...(req.tile !== undefined ? { tile: req.tile } : {}) }, press), actor);
      host.redraw();
      return result;
    };
    const home = p.block || this.msg?.id;
    const shown = () => home && p.line >= 0 ? pressing(home, p.line, () => host.redraw(), run, p.label) : run();
    return actor.kind === "user" ? d.pressDoing(p.act, { note: home }, shown) : shown();
  }

  /** The scripts called `name` as a press at `block`'s line `line` finds them (extensions.ts `scriptsAt`, the one lookup `script.run` shares). */
  private scriptsNamed(name: string, block: string | undefined, line: number | undefined, host: SurfaceHost) {
    return scriptsAt(host.ctx.board, name, block, line);
  }

  /**
   * What slot `key` of `button` is asked as (PIE-1298): the question of the argument that reads it, from that argument's own
   * declaration: an action's arg schema, or for a script step the slot the script declares (`[form-field::page note]`), read
   * from the script the press would run; the alt press's, alt='s argument (PIE-1660). Null when nothing declares it (as text).
   */
  private async slotQuestion(block: string, button: ButtonCall, key: string, host: SurfaceHost, alt = false) {
    const use = slotArgs(button, key, { alt })[0];
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
  async askSlots(block: string, button: ButtonCall, keys: readonly string[], host: SurfaceHost, actor: Actor, run = false, alt = false): Promise<unknown> {
    const key = keys[0]!, line = button.line + 1;
    const d = host.ctx.dispatch;
    if (!d) throw new ActionRefused("this screen has no dispatcher to ask with");
    const q = await this.slotQuestion(block, button, key, host, alt);
    if (actor.kind !== "user") {
      throw new ActionRefused(`${button.label} has no ${key} yet: it is the person's to choose; give it: button.slot note=${block} line=${line} key=${key}${alt ? " alt=true" : ""} value=<${q?.kind ?? "the value"}>${q?.kind === "tile" ? " (a tile's name, its id or drawer.agent)" : ""}`);
    }
    const tile = messageContext.getStore()?.tile;
    // The keys still to ask go with the answer (a re-pick asks filled slots too, so they can't be read again from `empty`).
    const later = keys.slice(1), rest = `${later.length ? ` next=${later.join(",")}` : ""}${run ? " run=true" : ""}${alt ? " alt=true" : ""}`;
    const then = `button.slot note=${block} line=${line} label=${JSON.stringify(button.label)} key=${key}${rest}${tile ? ` --tile ${tile}` : ""}`;
    const what = keys.length > 1 ? `${key} (${button.slots.findIndex(s => s.key === key) + 1} of ${button.slots.length})` : key;
    if (q?.kind === "tile") {
      host.ctx.flash(`${button.label}: choose a tile for ${key}`);
      return d.act({ action: "tile.pick", args: { then, prompt: `${button.label}: choose a tile for ${what}` }, ...(tile ? { tile } : {}) }, actor);
    }
    return askInBar(host.ctx as never, `${button.label}: ${what}`, [q ?? { name: "value", type: "text", label: key, free: true, required: true }], {}, actor,
      answers => d.act({ action: "button.slot", args: { note: block, line, label: button.label, key, value: answers.value ?? "", ...(later.length ? { next: later.join(",") } : {}), ...(run ? { run: true } : {}), ...(alt ? { alt: true } : {}) }, ...(tile ? { tile } : {}) }, actor));
  }

  /**
   * `button.slot` (PIE-1298): write one slot of a `::button` onto its line, through the note's checked save, recorded as whoever
   * asks; ctrl+z (sources.undo) takes it back. A tile is written as an address that stays true: the id of the tile (`t-<uuid>`) or
   * the place it fills (`drawer.agent`, `role:<role>`, `<slot>@<screen>`), never the number a layout gives it (`t7`, `3`, `#3`). With no value
   * the person is asked again (a re-pick); with `ask`, the next empty slot is asked after it.
   */
  async setButtonSlot(a: { note?: string; line?: number; label?: string; key?: string; value?: string; ask?: boolean; next?: string; run?: boolean; alt?: boolean }, host: SurfaceHost, actor: Actor): Promise<unknown> {
    const m = await host.ctx.board.get(a.note ?? this.requireNote().id); // the service's text, never this reader's copy, which catches up (PIE-1518)
    if (!m) throw new ActionRefused(`no note ${a.note}: button.slot note=<id> takes the note the button is written in`);
    if (this.msg?.id === m.id && !this.msg.partial && this.msg.revision !== m.revision) { this.refresh({ ...m, childIds: this.msg.childIds }); host.redraw(); }
    const named = slotButton(buttonCallsOf(m.text), a); if ("refused" in named) throw new ActionRefused(named.refused);
    const { button, key } = named;
    if (a.value === undefined) return this.askSlots(m.id, button, [key], host, actor, !!a.run, !!a.alt);
    const given = await this.slotValue(m.id, button, key, a.value, host, actor, !!a.alt);
    const line = button.line, before = m.text.split("\n")[line] ?? "", after = withButtonSlot(before, key, given);
    if (after === null) throw new ActionRefused(`that value can't be written on line ${line + 1}: a button line can't hold a newline, { or } in a value`);
    const wrote = after !== before;
    const r = await this.inTurn(() => this.rewriteLines(m.id, wrote ? [{ line, before, after }] : [], this.sourceHistory, host, actor, SOURCE_STALE));
    const said = `${button.label}: ${key}=${given}`;
    if (wrote) { host.ctx.flash(`${said}${actor.kind === "user" && !a.run ? " · press it again to use it · ctrl+z takes it back" : ""}`); this.noteAgent(actor, said); }
    host.redraw();
    const out: Record<string, unknown> = { block: m.id, line: line + 1, wrote: { [key]: given }, changed: wrote, revision: r.revision ?? null, recordedAs: recordedAnswer(actor) };
    const entry = wrote ? this.sourceHistory.last(partyOf(actor), this.msg?.id ?? m.id) : null;
    // More slots empty on the same press: the next is asked (the person's pick leaves the rest to this); an agent passes each itself.
    if (actor.kind === "user" ? a.next !== undefined || a.ask || a.run : a.run) {
      const now = await host.ctx.board.get(m.id), again = now ? buttonCallAt(now.text.split("\n"), line) : null;
      const left = actor.kind !== "user" ? [] : a.next !== undefined ? a.next.split(",").filter(Boolean) : a.ask ? (a.alt ? again?.altEmpty : again?.empty) ?? [] : [];
      const fail = (e: unknown) => host.ctx.flash(e instanceof Error ? e.message : String(e));
      if (again && left.length) void this.askSlots(m.id, again, left, host, actor, !!a.run, !!a.alt).catch(fail);
      // The last answer of a press runs it, as the press meant (PIE-1392), its alt= for an alt press; a slot still empty is asked by
      // that press (an agent is told the line). What it did is taken back with the words by one undo (PIE-1666).
      else if (again && a.run && again.act !== null && (a.alt ? again.alt : again.act)) {
        const layoutBefore = host.layoutNewestSeq?.();
        try {
          const ran = await this.runPress({ act: (a.alt ? again.alt : again.act)!, block: m.id, line, label: again.label }, host, actor, false, undefined, !!a.alt);
          out.ran = ran ?? null;
          const run = (ran as { undo?: unknown } | null)?.undo, layout = host.layoutNewestSeq?.();
          if (entry && typeof run === "string") { entry.then = { run }; EXT_UNDO.dropWhere(u => u.undo === run); }
          else if (entry && layout !== undefined && layout !== layoutBefore) entry.then = { layout };
        } catch (e) { if (actor.kind !== "user") throw e; fail(e); }
      }
    }
    return out;
  }

  /**
   * A slot's value as it is kept (PIE-1298): a tile is kept by an address the tile grammar reads as identity (its `t-<uuid>`, a
   * role, a slot of a screen); a name, a number, `t7` or `focused` is resolved now and kept as the tile's id, for none of those
   * names the same tile after a layout changes. A value that names no tile is refused with the resolver's reason (alt: as alt= reads it).
   */
  private async slotValue(block: string, button: ButtonCall, key: string, value: string, host: SurfaceHost, actor: Actor, alt = false): Promise<string> {
    if (!value) return value;
    const q = await this.slotQuestion(block, button, key, host, alt);
    if (q?.kind !== "tile") return value;
    const found = await tileNamed(host, value, actor);
    if ("why" in found) throw new ActionRefused(`not kept: ${found.why}`);
    return parseTileAddress(value).kind === "name" ? found.id : value;
  }

  // ── refreshing a resource's projection (PIE-445) ─────────────────────────────
  /** The line that runs under the [ ] position (an extension's line, a ticket region, a ticket), which R fetches or runs again before anything else. */
  private runsAtCurrent(): { block: string; line?: number } | null {
    const l = this.inView()?.link;
    if (l?.ext) return { block: l.ext.block, line: l.ext.line };
    if (l?.refresh) return { block: l.refresh, ...(l.refreshLine !== undefined ? { line: l.refreshLine } : {}) };
    return l?.role === "resource" && l.block ? { block: l.block } : null;
  }
  /**
   * The block `R` refreshes: a ticket region's page (or ticket block) under the [ ] position, else this note's one
   * line that runs. With no position and several lines that run (a handler line, a component, an @name request), `R`
   * runs none of them and says which there are: a stray key never asks an agent again or runs a script (PIE-956).
   */
  refreshTarget(): { block: string; line?: number } {
    const at = this.runsAtCurrent();
    if (at) return at;
    const m = this.msg!;
    // Not read yet: what the note runs isn't known, so nothing is asked of the service on a guess.
    if (!projectionsLoaded(m, this.src) && mayHaveProjections(m.text)) throw new ActionRefused(`reading what this note runs · press again in a moment, or press ${nextElementKey()} to step onto a line first`);
    const runs = linesThatRun(m, this.src);
    if (runs.length === 1) return { block: m.id, line: runs[0]!.anchor.line };
    if (runs.length > 1) throw new ActionRefused(`${this.runsWords(runs)} here: nothing ran · press ${nextElementKey()} to step onto one, then ${runAgainKey()}, or click its ${REGION_MARK} mark and its run again`);
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

  // ── scrolling ────────────────────────────────────────────────────────────────
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
    if (float === "edit-preview") { void this.runKey("draft.scroll", { by: wheelRows(dir), preview: true }, host); host.redraw(); return; }
    if (float) { this.attachedMode(float)?.wheel?.(dir, host, at); host.redraw(); return; }
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
    const by = isUp(k) ? -1 : isDown(k) ? 1 : k.kind === "pgdn" || c === " " ? this.pageBy(1) : k.kind === "pgup" ? this.pageBy(-1) : 0;
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
  foldsIn(m: Msg, inserted = true): { text: string; lines: number[]; points: FoldPoint[]; literal: Set<number>; unterminated: number | null; anchors: (string | undefined)[] } {
    const r = this.zoomed(m, readableSource(m, this.src));
    const sig = m.text + "\0" + r.text + "\0" + r.anchors.join("\0");
    if (this.foldCache?.text !== sig) this.foldCache = { text: sig, points: foldPoints(r.text, r.anchors), lines: r.lines };
    const all = m.text.split("\n");
    for (const p of this.foldCache.points) if (p.list) {
      const first = p.list.line;
      if (propertyTokensInLine(all[(r.lines[first] ?? 0) - 1] ?? "").some(t => t.key === "children" && t.value === "preview")) p.list.preview = true;
    }
    return { text: r.text, lines: r.lines, points: inserted ? [...this.foldCache.points, ...this.drawnFolds.filter(p => !this.foldCache!.points.some(own => own.key === p.key))].sort((a, b) => compareFoldPosition(a.order?.line ?? [a.line], b.order?.line ?? [b.line])) : this.foldCache.points, literal: r.literal, unterminated: r.unterminated, anchors: r.anchors };
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
    let hideTo: readonly number[] = [-1];
    for (const p of this.foldsIn(m).points) {
      if (compareFoldPosition(p.order?.line ?? [p.line], hideTo) < 0) continue;
      out.push(p);
      if (folded.has(p.key)) hideTo = p.order?.end ?? [p.end];
    }
    return out;
  }

  /** A person's fold selects it; an agent's preserves their selection and scroll. */
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

  /** Fold the outermost points or unfold all; only the person's action can release their selection.
   * Returns how many changed. */
  foldAll(on: boolean, select = true): number {
    if (!on) { const n = this.folded.size; this.folded.clear(); for (const p of this.msg ? this.foldsIn(this.msg).points : []) if (this.previews(p)) this.previewOpen.add(p.key); if (select) this.reveal = !!this.foldSel; return n; }
    this.previewOpen.clear();
    const all = this.msg ? this.foldsIn(this.msg).points : [];
    const outer = all.filter(p => !all.some(q => compareFoldPosition(q.order?.line ?? [q.line], p.order?.line ?? [p.line]) < 0 && compareFoldPosition(p.order?.line ?? [p.line], q.order?.end ?? [q.end]) < 0));
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
    // A template's source line edits its call; the heading's own position places the keys.
    const selected = visible ? vis.findIndex(p => p.key === this.foldSel) : -1;
    const current = visible && this.elems.find(e => e.key === this.cur), drawn = this.drawn;
    const distance = (p: FoldPoint) => { const row = drawn?.doc.heads.find(h => h.key === p.key)?.row; return current && row !== undefined ? row - (current.row - drawn!.top) : (lines[p.line] ?? 0) - line; };
    const p = selected >= 0 ? vis[(selected + d + vis.length) % vis.length] : (d === 1 ? vis.find(p => distance(p) >= (visible ? 1 : 0)) : vis.findLast(p => distance(p) <= -(visible ? 1 : 0))) ?? (d === 1 ? vis[0] : vis.at(-1));
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
    const top = this.foldsIn(m).lines.indexOf(this.readingRows() ? this.readingSourceLine() : this.position.view?.line ?? 0);
    const around = vis.filter(p => p.line <= top && top < Math.max(p.end, p.line + 1));
    return around.findLast(p => p.kind === "heading") ?? around.at(-1) ?? null;
  }

  /** The folds for `peek`: how many fold points, which are folded, and the one the keys selected. */
  private describeFolds(m: Msg) {
    const points = this.foldsIn(m).points, sel = points.find(p => p.key === this.foldSel);
    return { points: points.length, folded: points.filter(p => this.effectiveFolded(p)).map(foldLabel), selected: sel ? foldLabel(sel) : null };
  }

  // ── the view and the reading position ────────────────────────────────────────
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
    this.position.reading = lineStart(this.msg?.text ?? "", line);
  }

  readingSourceLine() { return lineAtOffset(this.msg?.text ?? "")(this.position.reading); }

  /** All wrapped rows of one source block, shared by navigation and ruler paint. */
  private blockRows(doc: Doc, row: number): [number, number] {
    const source = doc.source[row];
    let a = row, b = row + 1;
    while (a > 0 && doc.source[a - 1] === source) a--;
    while (b < doc.source.length && doc.source[b] === source) b++;
    return [a, b];
  }

  readingRows(): [number, number] | null {
    // The reader's rows, or a host's digest (a river column: the whole note, from row 0): one reading position over both.
    const d = this.drawn ?? (this.digesting && this.digested ? { doc: this.digested.doc, lines: this.digested.lines } : null);
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

  /** The collection whose row the `[ ]` position is on, or null (PIE-1501): its list keys are the position's. */
  listAtCursor(): ListHandle<any> | null { return listAtCursor(this.rowWorld()); } // the list whose row [ ] is on, a collection or not (PIE-1534)

  /** What the last layout drew, lent to the row containers (row-container.ts); a pick lands as a click's does when there's a host. */
  private rowWorld(host?: SurfaceHost): RowWorld<Element> {
    const d = this.drawn, text = this.msg?.text.split("\n") ?? [];
    return {
      elems: this.elems, inline: this.inlineLists, lists: this.listsDrawn, cursor: this.selectedElement(), wanted: this.rowWanted(),
      lineOf: e => { const s = d?.doc.source[e.row - d.top]; return s === undefined ? undefined : d!.lines[s]; },
      text: line => text[line] ?? "",
      pick: (l, row) => { if (host) void this.listHost(host).picked(l, row); else this.selectListRow(l, row.id, row.group); },
      selectInline: (e, row) => { this.selectInlineRow(e, row); },
    };
  }

  /**
   * j k (reading.step): the container the `[ ]` position is in steps its rows (row-container.ts); past its edge, or off
   * every container, the reading line walks on to the next block with text, and lands on the first (j) or last (k) row of
   * a container drawn there. `through`: walk past the container the position is in instead of stepping it.
   */
  stepReading(by: 1 | -1, through = false, host?: SurfaceHost) {
    const world = this.rowWorld(host), inside = rowContainerAt(world), was = this.selectedElement();
    if (inside && !through) {
      if (inside.step(by) !== "edge") return;
      // k from its first row, with the block's own text above the rows: onto that text.
      if (by < 0 && inside.lead) { this.letGo(); return; }
    }
    // The reading line on a container's block, the position off its rows (esc let go of it): j goes into it.
    const here = inside ? null : rowContainerOn(world, this.readingSourceLine(), by);
    if (here && !through && by > 0 && here.land("first")) return;
    this.letGo();
    const d = this.drawn;
    if (!d) return;
    const rows = this.readingRows(), from = this.readingSourceLine();
    const visible = rows && rows[1] > this.scroll && rows[0] < this.scroll + d.room;
    // A tall block a screen at a time; leaving a container's block walks on, never a screen of it at a time.
    if (!inside && !here && visible && (by > 0 ? rows[1] > this.scroll + d.room : rows[0] < this.scroll)) {
      this.scroll = by > 0 ? Math.min(rows[1] - 1, this.scroll + d.room) : Math.max(rows[0], this.scroll - d.room);
      return;
    }
    const sourceLines = this.msg!.text.split("\n");
    let row = visible ? (by > 0 ? rows[1] : rows[0] - 1) : this.scroll;
    while (row >= 0 && row < d.doc.source.length) {
      const source = d.doc.source[row]!, line = d.lines[source];
      // The next line with text; a container's block drawn in several parts (a figure's frame and rows) is one stop.
      if (line !== undefined && sourceLines[line]?.trim() && !(visible && line === from && rowContainerOn(world, line, by))) {
        this.foldSel = null;
        this.readingLine(line);
        const p = this.foldsIn(this.msg!).points.find(p => d.lines[p.line] === line && this.previews(p));
        if (p) { this.foldSel = p.key; this.selectListPoint(); }
        const landed = rowContainerOn(world, line, by);
        if (landed && !(by > 0 && landed.lead)) landed.land(by > 0 ? "first" : "last");
        this.revealReading();
        const block = this.readingRows();
        if (by < 0 && visible && block && block[1] - block[0] > d.room) this.scroll = Math.max(block[0], block[1] - d.room);
        return;
      }
      row += by;
    }
    // Nothing that way: from a container the position stays on its edge (or the control it was on); from off one, a
    // collection no line names (a saved view opened as its own note) takes it: j its kept pick, else its first row; k its last.
    if (inside) { if (!inside.land(by > 0 ? "last" : "first") && was) this.selectElement(was); return; }
    loneCollection(world)?.land(by > 0 ? "first" : "last");
  }

  /** The note line (from 0, the subject line) reader row `y` of the last render shows, or null off the note's body. */
  sourceLineAt(y: number): number | null {
    const d = this.drawn;
    if (!d) return null;
    const row = y - d.heroRows - d.top;
    if (row < 0 || row >= d.room) return null;
    const body = d.doc.source[d.scroll + row];
    return body === undefined ? null : d.lines[body] ?? null;
  }

  // ── elements: what [ ] walks, ⏎ acts on and the ruler tints (PIE-441) ─────

  /** The current element's figure's keys, for the hint: its tabs and its density. */
  private figureHint(): string {
    const f = this.currentFigure();
    return f ? ` · ${hintOf(figureKeys(!!f.tabs))} · ${modeHint(FIGURE_SIZE_KEYS, name => NOTE_ACTIONS.def(name))}` : "";
  }

  /** Nothing is current: the next `[ ]` starts from the view, and ⏎ is the host's again. */
  letGo() { this.cur = null; this.pendingRow = null; }
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
    // A row of an inline ::links (PIE-693): it's that component's selection too, and its preview follows.
    const lb = l?.listRow;
    if (lb?.row) { try { this.listViews.get(lb.key)?.pick(PERSON, lb.row, lb.group); } catch { /* a row the list no longer draws */ } }
  }

  /** The ::button the reading line is on, in view, with no element current: what ⏎ presses there (PIE-1518). */
  buttonAtReading() {
    const v = this.drawn ?? (this.digesting ? { top: 0, scroll: 0, room: Infinity } : null), r = this.readingRows();
    return v && r && !this.cur ? buttonIn(this.elems, v.top + Math.max(r[0], v.scroll), v.top + Math.min(r[1], v.scroll + v.room)) : null;
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
   * is current, over the target index the last layout drew (the reader's rows or a river column's digest).
   * False when there's nothing to step to.
   */
  step(d: 1 | -1): boolean {
    const v = this.drawn ?? (this.digesting ? { top: 0, scroll: 0, room: Infinity } : null), es = this.elems;
    if (!v) return false;
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
    const how: OpenHow = { link: true, fresh, by: actor, standing: select };
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

  /** The margin's side column at reader width `w`: 0 when the cards fold under their passages (or there are none). */
  private marginCols(m: Msg, w: number): number {
    // Printed (`ep0ch show`), the threads are read with outline_threads: no cards in the drawing.
    return marginColumn(w, this.printed ? "off" : this.marginMode, this.cardThreads(m).length);
  }
  /** The threads drawn as cards. The margin's default (PIE-791): current threads only; seen and resolved are on the thread list's earlier shelf. */
  private cardThreads(m: Msg): Comment[] {
    return (this.commentsFor === m.id ? this.comments ?? [] : []).filter(c => (c.start !== null || isWholeNote(c)) && this.threadShown(c.id));
  }
  /** The whole-note threads folded to their [+] after the header (wholeNoteMarks). */
  private foldedWhole(): Comment[] { return (this.comments ?? []).filter(c => isWholeNote(c) && !this.threadShown(c.id)); }
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
    if (this.expanded.has(thread)) void host.ctx.board.request("annotations.read", { annotationId: thread }).catch(() => {});
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

  // ── values, ::use controls, comment marks, the element index and the focus mark ────
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
  private elementsOf(doc: Doc, drawn: Link[], marks: Mark[], controls: Control[], summary: { from: number; to: number; link: Link; key: string; row?: number }[], points: readonly FoldPoint[], top: number, head: string[], summaryRow = 1, imageRef: ((i: number) => ImageRef | null) | null = null): Element[] {
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
    for (const l of summary) { const row = l.row ?? summaryRow; out.push({ key: keyOf("link", l.link), kind: "link", row, from: l.from, to: l.to, ruler: [row, row + 1], label: `${l.key} ${text(head[row] ?? sum, l.from, l.to)}`, link: l.link, value: l.key }); }
    for (const h of doc.heads) {
      const p = points.find(p => p.key === h.key);
      if (p && (p.kind === "heading" || this.previews(p))) out.push({ key: `fold:${p.key}`, kind: "fold", fold: p.key, row: top + h.row, from: this.gutterStart, to: this.bx + h.cols, ruler: [top + h.row, top + h.row + (h.rows ?? 1)], label: p.text });
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
      if (kind === "row" || l.figure?.row !== undefined) ruler = [top + r.line, top + rs.at(-1)!.line + 1];
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
        : l.figure?.row !== undefined ? l.label! : l.query ?? (l.media && !l.role ? fileName(l.media) : rs.map(x => text(doc.lines[x.line]!, x.from, x.to)).join(" "));
      out.push({ key: keyOf(kind, l), kind, row: top + r.line, from: r.from + this.bx, to: r.to + this.bx, ruler, label, link: l, ...(ITEM_KINDS.has(kind) ? { item: [top + r.line, top + rs.at(-1)!.line + 1] as [number, number] } : {}), ...(l.task ? { task: l.task } : {}), ...(l.callout ? { callout: l.callout } : {}) });
    }
    // A generated region's mark (src/output-region.ts): one `[ ]` stop in the gutter beside its first row, over its rows.
    for (const r of doc.regions ?? []) {
      const info = this.regionInfo.get(r.key);
      if (!info) continue;
      const kind = (info.target.role ?? "link") as ElementKind;
      out.push({ key: keyOf(kind, info.target), kind, row: top + r.row, from: this.gutterStart, to: this.gutterStart + 1, ruler: [top + r.row, top + r.row + 1], label: info.label, link: info.target, region: r.key });
    }
    for (const x of doc.media) {
      const image = imageRef?.(x.line) ?? undefined;
      out.push({ key: keyOf("link", { media: x.path }), kind: "link", row: top + x.row, from: this.bx, to: this.bx + width(doc.lines[x.row] ?? ""), ruler: block(x.row), label: x.spec.fence ? x.spec.path : x.path.split("/").pop() ?? x.path, link: { media: x.path, ...(image ? { image } : {}) } });
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

  // ── live figures: a tabs figure's tab, a table's density (src/graphs.ts); this reader's, never the note's ──

  /** The figures the last layout drew: each one's number, kind, title, density, and a tabs figure's tabs and counts. */
  describeFigures() {
    return this.figuresDrawn.map(f => ({ n: f.n, kind: f.kind, title: f.title, density: f.density, ...(f.rowCount !== undefined ? { rowCount: f.rowCount } : {}), width: f.size.width, height: f.size.height, cols: f.cols, rows: f.rows, ...(f.tabs ? { tab: f.tab ?? null, tabs: f.tabs.map((t, i) => ({ n: i + 1, ...t, shown: t.value === f.tab })) } : {}) }));
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
  figureNamed(which: string | undefined, want: "tabs" | "rows" | "any"): FigureInfo {
    this.requireDrawn();
    const fits = (f: FigureInfo) => (want === "any" ? true : want === "tabs" ? f.kind === "tabs" : f.kind === "tabs" || f.kind === "table");
    const fs = this.figuresDrawn.filter(fits), what = want === "any" ? "figure" : want === "tabs" ? "tabs figure" : "table or tabs figure";
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
      this.cur = `${figureElemBase({ figure: f.key, tab: value })}#0`; this.reveal = true;
      // Another key in this input chunk must see the new tab's rows before the host paints.
      const d = this.drawn, digest = this.digested;
      withFigureBoard(host.ctx.board, () => host.redraw(), () => {
        if (d) this.renderReading(d.w, d.h, host, null);
        else if (this.digesting && digest) this.digest(digest.m, digest.w, host, digest.maxImageRows, digest.inset);
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
   * next or previous tab, = fit/full, shift+arrows scroll inside, ⏎ on a tab or the density control that one. Null for any other key.
   */
  private figureKey(k: Key): { name: "figure.tab" | "figure.density" | "figure.size" | "figure.scroll" | "figure.row"; args: Record<string, unknown> } | null {
    if (this.modes.top()) return null;
    const f = this.currentFigure();
    if (!f) return null;
    const figure = String(f.n), e = this.inView();
    if (f.tabs && (k.kind === "tab" || k.kind === "backtab" || k.kind === "left" || k.kind === "right")) return { name: "figure.tab", args: { figure, by: k.kind === "tab" || k.kind === "right" ? 1 : -1 } };
    const size = modeBinding(FIGURE_SIZE_KEYS, k);
    if (size) return { name: size.action as "figure.size" | "figure.scroll", args: { figure, ...size.args } };
    if (k.kind === "enter" && e?.kind === "figure") return e.link?.figure?.row !== undefined ? { name: "figure.row", args: { figure, row: e.link.figure.row } } : e.link?.figure?.tab !== undefined ? { name: "figure.tab", args: { figure, tab: e.link.figure.tab } } : { name: e.link?.figure?.size ? "figure.size" : "figure.density", args: { figure } };
    return null;
  }

  // ── images and the header image (PIE-532) ────────────────────────────────────
  /**
   * A key this reader takes ahead of its host's own while a live figure's element is current (tab and shift+tab
   * cycle a desk's tiles, ← → step a river's columns or a BBS reader's messages otherwise): the host asks first.
   */
  claims(k: Key): boolean {
    const list = this.listsDrawn.find(l => l.key === this.listIn);
    return !!list && (!!list.view.typing || !!listBinding(k, !!list.change, list.view.pickable().length)) || !!collectionBinding(this, k) || this.modes.get("form") !== null || (!!this.currentFigure() && (isUp(k) || isDown(k))) || !!this.figureKey(k) || (!!this.imageKey(k) && ch(k) !== "H");
  }

  /** Whether `k` is an image's key here now (imageKey): a host that owns H too (the river) asks this. */
  imageKeyOf(k: Key): boolean { return !!this.imageKey(k); }

  /**
   * The image action key `k` runs while an image is the current element (PIE-532): + - its size (a header's height),
   * ← → where it sits, H the note's header on or off. Null for any other key. The host asks first for all but H
   * (claims): in a float, H stays the float's (float.place), and the caption's [▀] makes it the header.
   */
  private imageKey(k: Key): { name: "image.size" | "image.align" | "image.hero" | "image.fit"; args: Record<string, unknown> } | null {
    if (this.modes.top()) return null;
    const e = this.inView();
    if (!e?.link?.image || !e.link.media) return null;
    const c = ch(k);
    if (c === "+" || c === "-") return { name: "image.size", args: { by: c === "+" ? 1 : -1 } };
    if (parsePictureFence(e.link.image.source)) return null;
    if (c === "H") return { name: "image.hero", args: {} };
    const hero = parseMediaLine(e.link.image.source)?.layout === "hero";
    if (!hero && (k.kind === "left" || k.kind === "right")) return { name: "image.align", args: { by: k.kind === "right" ? 1 : -1 } };
    if (hero && c === "=") return { name: "image.fit", args: {} };
    return null;
  }

  /** A click on an image's caption control: the image becomes the `[ ]` position, and the control's action runs as the person's. */
  private pressImage(ref: ImageRef, host: SurfaceHost) {
    const e = this.elems.find(x => x.link?.image && !x.link.image.control && x.link.image.block === ref.block && x.link.image.id === ref.id);
    if (e) this.setElem(e);
    const c = ref.control, picture = ref.id;
    if (!c) return;
    if ("size" in c) void this.runKey("image.size", { by: c.size, picture }, host);
    else if ("align" in c) void this.runKey("image.align", { by: c.align, picture }, host);
    else if ("fit" in c) void this.runKey("image.fit", { to: c.fit, picture }, host);
    else if ("open" in c) void this.runKey("artifact.open", { picture }, host);
    else if ("share" in c) void this.runKey("artifact.share", { picture }, host);
    else void this.runKey("image.hero", { on: c.hero, picture }, host);
    host.redraw();
  }

  /** Note `m`'s pictures (picture.ts), its script's drawings among them once the service has answered. */
  private picturesOf(m: Msg): Picture[] { return this.notePictures.of(m.text, isOutlineNote(m) ? projectionsOf(m, this.src) : [], !isOutlineNote(m) || projectionsLoaded(m, this.src)); }

  /** The pictures the reader draws of note `m`, in reading order: not one under a fold. */
  imagesIn(m: Msg): (ImageRef & { spec: MediaSpec })[] {
    const shown = new Set(this.foldsIn(m).lines);
    return this.picturesOf(m).filter(p => shown.has(p.line)).map(p => ({ ...imageRefTo(m, p), spec: p.spec }));
  }

  /**
   * The image a person's key means when it names none (the current element in view), or the one `n` (from images),
   * `line` (its note line, 1 the subject) or `picture` (its id, from images) names.
   */
  async imageNamed({ n, line, picture }: { n?: number; line?: number; picture?: string }, actor: Actor): Promise<ImageRef & { spec: MediaSpec }> {
    if (n === undefined && line === undefined && picture === undefined) {
      if (actor.kind === "agent") throw new ActionRefused("say which image: n= (images lists them) or line=");
      const r = this.inView()?.link?.image;
      // As the note reads now (a change just saved, + pressed twice, has moved on from the last render).
      const now = r && this.msg?.id === r.block ? this.imagesIn(this.msg).find(x => x.id === r.id) : undefined, spec = r ? parseImageLine(r.source) : null;
      if (now || (r && spec)) return now ?? { ...r!, spec: spec! };
      throw new ActionRefused("say which image: n= or line= (images lists them), or put [ ] on an image");
    }
    const all = this.imagesIn(await this.whole());
    if (picture !== undefined) { const hit = all.find(x => x.id === picture); if (hit) return hit; throw new ActionRefused(IMAGE_STALE.refused, "stale-revision"); }
    const listed = () => all.slice(0, 12).map((x, i) => `${i + 1} line ${x.line + 1} ${x.path.split("/").pop()}`).join("; ") || "none";
    const hit = n !== undefined ? all[n - 1] : all.find(x => x.line + 1 === line);
    if (!hit) throw new ActionRefused(`no such image in this note (${listed()})`);
    return hit;
  }

  /** How each image is drawn now, by its note line: its cells and where it sits, or the header's rows. */
  drawnImages(): Map<number, DrawnImage> {
    return drawnImagesOf(this.drawn, this.hero);
  }
  /** Note `m`'s header, the one place that decides it (picture.ts): a script's drawing as the file it was made into. Null while that isn't made yet, or when it has none. */
  heroRef(m: Msg) { return headerRef(m, this.picturesOf(m)); }
  /** The note's header image as the tune shows it (PIE-1361): its line, its file, its look as written, its rows drawn; null when it has none. */
  heroInfo(m: Msg): { line: number; name: string; values: Partial<Record<HeroProp, string>>; rows: number | null } | null {
    const ref = this.heroRef(m);
    if (!ref) return null;
    const values = Object.fromEntries(HERO_PROP_NAMES.flatMap(p => { const v = heroPropText(ref.spec, p); return v === undefined ? [] : [[p, v]]; }));
    return { line: ref.line, name: ref.path.split("/").pop() ?? ref.path, values, rows: this.hero?.line === ref.line ? this.hero.full : null };
  }
  /** How many rows the header image takes now, or null when the reader doesn't draw one. */
  heroRowsDrawn(): number | null { return this.hero?.full ?? null; }
  /** The rows the header image took above the body in the last render (none before one): what a cell's row is under. */
  private get heroTop(): number { return this.drawn?.heroRows ?? 0; }

  /**
   * Change an image's line (PIE-532): its layout properties (`set`), and with `others`, other image lines of the
   * note too (the header moving from one image to another), as one save through rewriteLines, recorded as `actor`'s;
   * image.undo (ctrl+z) puts the lines back.
   */
  async changeImage(ref: ImageRef & { spec: MediaSpec }, set: Partial<Record<MediaAttr, string | null>>, what: string, host: SurfaceHost, actor: Actor, others: { id: string; kind: Picture["kind"]; set: Partial<Record<MediaAttr, string | null>> }[] = []) {
    // Each found by who it is in the note as the service has it now, wherever that is.
    let edits: LineEdit[] = [];
    const editsIn = (m: Msg) => (edits = pictureEdits(m.text, [{ id: ref.id, kind: ref.kind, set }, ...others], () => { host.ctx.flash(IMAGE_STALE.flash); return new ActionRefused(IMAGE_STALE.refused, "stale-revision"); }));
    const name = ref.path.split("/").pop() ?? ref.path;
    const r = await this.rewriteLines(ref.block, editsIn, this.imageHistory, host, actor, IMAGE_STALE);
    if (!edits.length) return { block: ref.block, line: ref.line + 1, changed: false, image: ref.source, revision: r.revision ?? null };
    // The person's image stays in view as it grows or moves, so its keys keep working on it.
    if (standsAsPerson(actor, host.ctx.person?.() ?? NOBODY, "tile")) this.reveal = true;
    const said = `image ${printable(name)}: ${what}`;
    host.ctx.flash(said);
    this.noteAgent(actor, said);
    host.redraw();
    const own = edits.find(e => e.picture === ref.id);
    return { block: ref.block, line: (own?.line ?? ref.line) + 1, changed: true, image: own?.after ?? ref.source, revision: r.revision ?? null, recordedAs: recordedAnswer(actor) };
  }

  inTurn<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lineTurn.catch(() => {}).then(fn);
    this.lineTurn = next;
    return next;
  }

  /** Undo the last image change `actor` made while reading this note. */
  async undoImage(host: SurfaceHost, actor: Actor) {
    const r = await this.inTurn(() => this.undoLines(this.imageHistory, "image", host, actor));
    return { block: r.block, lines: r.edits.map(e => ({ line: e.line + 1, image: e.before })), revision: r.revision, recordedAs: recordedAnswer(actor) };
  }

  /** One step bigger or smaller for picture `ref` (picture.ts), in the room this reader has for it. */
  pictureStep(ref: ImageRef & { spec: MediaSpec }, by: number, host: SurfaceHost) {
    const d = this.drawn, digest = this.digested, [cellW, cellH] = cellOf(host);
    const body = d ? d.w - d.bx - this.bxRight - d.mcols : digest ? digest.w - digest.inset : 80;
    return stepOf(ref, by, this.drawnImages().get(ref.line), this.msg ? this.picturesOf(this.msg) : [], { cellW, cellH, maxImageRows: digest && !d ? digest.maxImageRows : this.imageRowsMost, body, header: { rows: this.hero?.full ?? null, most: this.hero?.max ?? Infinity } });
  }

  // ── figure controls, buttons' hints and the element list ─────────────────────
  /** An agent's (or anyone's) `element.open` on a figure's control: figure.tab or figure.density as `actor`. */
  runFigureControl(c: FigureControl, host: SurfaceHost, actor: Actor): Promise<unknown> {
    const f = this.figuresDrawn.find(x => x.key === c.figure);
    if (!f) throw new ActionRefused("that figure isn't drawn now (figures lists what is)");
    return this.act(c.row !== undefined ? "figure.row" : c.tab !== undefined ? "figure.tab" : c.size ? "figure.size" : "figure.density", c.row !== undefined ? { figure: String(f.n), row: c.row } : c.tab !== undefined ? { figure: String(f.n), tab: c.tab } : { figure: String(f.n) }, host, actor);
  }
  /** A click (or ⏎ through `open`) on a figure's control: the action its key runs. */
  pressFigure(c: FigureControl, host: SurfaceHost) {
    const f = this.figuresDrawn.find(x => x.key === c.figure);
    if (!f) return;
    if (c.row !== undefined) void this.runKey("figure.row", { figure: String(f.n), row: c.row }, host);
    else if (c.tab !== undefined) void this.runKey("figure.tab", { figure: String(f.n), tab: c.tab }, host);
    else void this.runKey(c.size ? "figure.size" : "figure.density", { figure: String(f.n) }, host);
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

  /** The elements as `peek` and the `elements` action list them. */
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
  async copyNoteRef(kind: NoteRefKind, host: SurfaceHost, actor: Actor, own: string | undefined, line?: number): Promise<{ id: string; kind: string; text: string; clipboard: boolean; line?: number; anchor?: string; created?: boolean; recordedAs?: RecordedAs }> {
    const m = await this.whole();
    const where = { outline: m.address?.outline ?? own, foreign: !!m.address?.outline && m.address.outline !== own };
    const said = (msg: string) => this.noteAgent(actor, msg);
    if (kind !== "line") return deliverNoteRef(host.ctx, actor, m.id, kind, await noteCopyText(host.ctx.board, kind, m, where), said);
    const { at, next } = this.refLine(m, actor, line);
    if (m.revision === undefined) throw new ActionRefused("this note has no revision to anchor a line at");
    // The part of the note holding the line, as the service reads it, anchored and copied by the one owner (PIE-1390).
    return copyLineRef(host.ctx, actor, { blockId: m.id, line: at, next, revision: m.revision, title: subject(m), ...(where.foreign && where.outline ? { outline: where.outline } : {}) }, said);
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

  // ── the current element, clicks, and following a link ────────────────────────
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
      if (y === pr.row && !host.hasWiredPreview?.() && x >= pr.col + pr.cols - width(`[${this.listPreview.place} ▸]`)) void this.runKey("placement.menu", { target: "list-preview" }, host);
      else if (y > pr.row) {
        const hit = this.previewHits.find(h => h.row === y && x >= h.from && x < h.to);
        if (hit) { if (hit.link.choice !== undefined) void this.choose(hit.link.choice, host); else this.pressLink(hit.link, undefined, this.cur, undefined, !!host.freshClick, host); } // a choice row chooses; else its element's activation
        else void this.runKey("list.preview.edit", {}, host);
      }
      return true;
    }
    const heroLink = this.heroLinkAt(x, y);
    if (heroLink && !this.editing && !this.floatAt(x, y, host)) return this.pressLink(heroLink.link, undefined, this.cur, undefined, !!host.freshClick, host);
    // The note's rows are under its header image (PIE-532).
    y -= host.attachment ? 0 : this.heroTop;
    // The `[ ]` position as the click found it: a click's own reading.place lets go of it first.
    const was = this.cur;
    const float = this.floatAt(x, y + this.heroTop, host);
    if (float) { this.attachedMode(float)?.click(x, y, host); return true; }
    const h = this.hitAt(x, y);
    if (h && ("listPreview" in h || "sources" in h || "zoom" in h)) return this.pressTarget(h, host, was);
    // An open mode first (in its precedence): the edit's or comment's own click, a status choice's row, a panel row.
    const taken = this.modes.click(x, y, host);
    if (taken !== undefined) return taken;
    if (!this.editing && !host.attachment) {
      const line = this.sourceLineAt(y + this.heroTop);
      const p = this.msg && this.foldsIn(this.msg).points.find(p => this.foldsIn(this.msg!).lines[p.line] === line && this.previews(p));
      if (p && !(h && "link" in h)) {
        const e = this.elems.find(e => e.key === `fold:${p.key}`);
        if (e) { void this.runKey(was === e.key ? "element.open" : "element.select", { n: this.elems.indexOf(e) + 1 }, host); return true; }
      }
    }
    if (!this.editing) { const line = this.sourceLineAt(y + this.heroTop); if (line !== null) void this.runKey("reading.place", { line: line + 1 }, host); }
    // The header image: a click on it makes it the `[ ]` position, as a click on any image does.
    if (y < 0) { const i = this.elems.findIndex(e => !!e.link?.media && e.link.image?.line === this.hero?.line); if (i >= 0) void this.runKey("element.select", { n: i + 1 }, host); return i >= 0; }
    return this.pressTarget(h, host, was);
  }

  /**
   * What a press on target `h` does, wherever its host drew it (PIE-1543): the reader's own rows (click) and a river
   * column's digest and sticky header press the same index of targets, so a chip, a crumb, a fold, a copy control or a
   * link does the same thing in both. `was`: the `[ ]` position before the press; `fresh`: an alt-, ctrl- or
   * middle-click (else the host's freshClick).
   */
  pressTarget(h: Hit | undefined, host: SurfaceHost, was: string | null = this.cur, fresh = !!host.freshClick): boolean {
    if (h && "listPreview" in h) { void this.runKey("list.preview", { n: h.listPreview }, host); return true; }
    if (h && "sources" in h) { void this.runKey("sources.open", {}, host); return true; }
    if (h && "zoom" in h) { void this.runKey("element.zoom", h.zoom < 0 ? { on: false } : { line: h.zoom + 1 }, host); return true; }
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
    // The byline's [comment] (PIE-846): as its key would, where the host keeps track of the person's session.
    // The byline's comment count (PIE-873): the margin's next mode, as M.
    if (h && "margin" in h) { void this.runKey("margin", {}, host); return true; }
    if (h && "start" in h) { if (host.startSession) void host.startSession(h.start); else this.startAsPerson(h.start, host).catch(e => { host.ctx.flash(e instanceof Error ? e.message : String(e), undefined, errorDetails(e)); host.redraw(); }); return true; }
    // A chip of the passage toolbar (ADR 0004 contract 5): what its key after `a` does, on the person's selection.
    if (h && "passage" in h) { this.modes.drop("passage-menu"); this.passagePick(h.passage, host); return true; }
    // A click anywhere else lets go of the selection, and does what it always did.
    if (this.selection) void this.runKey("select.clear", {}, host);
    if (!h) return false;
    // A comment mark: its thread opens, as ⏎ on it does, and it's the `[ ]` position (PIE-441).
    // A host that draws no thread cards (a river column: its comments are its replies) shows the thread its own way.
    if ("thread" in h) {
      const i = this.elems.findIndex(e => e.key === h.elem);
      if (i >= 0) void this.runKey("element.open", { n: i + 1 }, host);
      else if (host.showThread) host.showThread(h.thread);
      else void this.runKey("thread.toggle", { thread: h.thread }, host);
      host.redraw();
      return true;
    }
    // A row of an open choice (a step's status, a callout's type) chooses it: the reader's picker mode takes it first, a
    // river column's digest (no mode stack of its own) lands here; with the choice gone, nothing. A panel row is its mode's.
    if ("pick" in h) { if (!this.picker) return false; void this.choose(h.pick, host); return true; }
    if ("prop" in h) return false;
    // An image itself: it becomes the `[ ]` position, so its keys (+ - ← → H) change it; ⏎ or a click on its caption opens it.
    if ("image" in h) { void this.runKey("element.select", { n: this.elems.findIndex(x => x.key === h.image) + 1 }, host); return true; }
    // A link (in the text, the summary line, an embed's title, a figure's row): the `[ ]` position, then
    // it opens where ⏎ on it would.
    // A row of an open choice (a step's status, a callout's type) chooses it.
    if (h.link.choice !== undefined) { void this.choose(h.link.choice, host); return true; }
    return this.pressLink(h.link, h.elem ? this.elems.find(e => e.key === h.elem) : undefined, was, h.value, fresh, host);
  }

  /** The link of the header's picture at this cell of the tile. */
  private heroLinkAt(x: number, y: number) { return this.heroHits.find(r => r.row === y && x >= r.from && x < r.to); }

  /**
   * A press on a link the surface drew, wherever its host drew it (a reader's own rows, a river column's digest, PIE-1392):
   * its element (`e`, else the one the target index holds for it) gets the one activation (`activate`), as ⏎ on it would;
   * a list row selects first and opens on the second press. `was` is the `[ ]` position before the press, `value` a
   * summary-line value's key, `fresh` an alt-, ctrl- or middle-click.
   */
  private pressLink(link: Link, e: Element | undefined, was: string | null, value: string | undefined, fresh: boolean, host: SurfaceHost): boolean {
    // An image's caption control (PIE-532), a click target only: the image becomes the `[ ]` position, and the control's action runs.
    if (link.role === "image" && link.image) { this.pressImage(link.image, host); return true; }
    e ??= this.elems.find(x => x.link === link) ?? this.elems.find(x => !!x.link && sameElementLink(x.link, link));
    if (!e) {
      // A link with no element drawn for it: opened as ⏎ on it would be.
      host.redraw();
      const i = this.links.findIndex(x => sameLink(x, link));
      if (i >= 0 && value === undefined) void this.runKey("link.follow", { n: i + 1, ...(fresh ? { fresh } : {}) }, host);
      else if (value !== undefined) void this.followValue({ key: value, target: link.block ? { block: link.block } : { page: link.page! } }, host, { link: true });
      else void this.followLink(link, host, fresh);
      return true;
    }
    // A row of an inline ::links (PIE-693), as a links tile's row (PIE-794, one list model): a click selects it (the [ ]
    // position; its preview and a preview linked to this reader follow), a second click on it, however long after, opens it (⏎, PIE-1541),
    // an alt-, ctrl- or middle-click opens it fresh (alt+⏎); the click that gives the reader the keys only selects.
    // A figure's row is a list row like any other (Evan, Oct 21: a click selects and previews; it never opens at once).
    // A grid's cell (a live calendar's day, an activity cell) has nothing to preview: one click lists its notes, as ⏎
    // on it does (PIE-1457).
    const lbk = link.listRow;
    if ((lbk?.row || e.link?.inlineList) && !link.cell && !host.opensOnClick?.(link)) {
      const i = this.elems.indexOf(e), inline = e.link?.inlineList;
      const presses = inline ? this.inlineLists.get(inline.key)!.view : this.linkPresses;
      const g = presses.press(inline?.row ?? i, { focusing: !!host.focusing, selected: e.key === was, untimed: e.key === was && !host.focusing });
      if (lbk?.row) {
        const n = this.listViews.get(lbk.key)!.indexOf(PERSON, { id: lbk.row, group: lbk.group }) + 1;
        void this.runList(g === "open" || fresh ? "list.open" : "list.pick", { list: lbk.key, n, ...(fresh ? { where: "new" } : {}) }, host);
      } else if (g === "open" || (g === "select" && fresh)) void this.activate(e, host, fresh);
      else void this.runKey("element.select", { n: i + 1 }, host);
      host.redraw();
      return true;
    }
    // Everything else is ⏎ on it: a link follows, a step's box opens its choice, a proposal's or a figure's control runs,
    // a button presses (alt+click: its alt=, or asking for its slots again, PIE-1298).
    void this.activate(e, host, fresh);
    host.redraw();
    return true;
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
    const artifact = await host.ctx.board.request("artifacts.show", { name: ref.path });
    if (artifact.deploy) throw new ActionRefused(`${artifact.deploy.repo} is a repo: its site${artifact.url ? ` (${artifact.url})` : ""} is public already, and a share gives a stored artifact alone; artifact.open opens the site`);
    const started = await startShare(host.ctx.board, { artifact: artifact.version ? `${artifact.name}@${artifact.version}` : artifact.name, ...(ttl ? { ttl } : {}) }, actor);
    const { share } = started;
    if (actor.kind === "user" && share.url) host.ctx.copy?.(share.url, "share link");
    host.ctx.flash(`${share.url && actor.kind === "user" ? "copied the link · " : ""}shared ${artifact.name} alone for ${endsIn(share.expiresAt)}${share.url ? `: ${share.url}` : ` · ${started.said ?? ""}`} · share.revoke id=${share.id} ends it`, 15_000);
    return started;
  }

  async openArtifact(ref: ImageRef, host: SurfaceHost): Promise<Outside> {
    const artifact = await host.ctx.board.request("artifacts.show", { name: ref.path });
    // A repo opens its live site; one that isn't live says why and the command that deploys it (PIE-1060).
    if (artifact.deploy && !artifact.url) throw new ActionRefused(`${artifact.deploy.repo} isn't live: ${artifact.deploy.said ?? artifact.deploy.state}${artifact.deploy.command ? `; run ${artifact.deploy.command}` : ""}`);
    if (!artifact.url) throw new ActionRefused("Set EP0CH_WEB_URL on the outline host to the web client's address (https://my.ep0ch.sh): an artifact opens as its page there.");
    return this.openOutside("browser", artifact.url, host);
  }

  /** Open what a link names: media in the system viewer, web pages in the browser (openOutside), blocks and pages through the host (`how`, where). */
  private async followTarget(l: Link, host: SurfaceHost, how: OpenHow = { link: true }): Promise<Msg | Outside | TagList | SoftChoices | null> {
    how = { ...how, ...(l.openWhere && !how.fresh ? { where: l.openWhere } : {}) };
    if (l.soft) return followSoft(this.pageOffers, l.soft, host, how);
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
      // A note of this outline (its web link names it, an ep0ch:// address always does, PIE-1401) opens as this outline's own.
      const { outline, machine, ...here } = to.target;
      const info = outline ? await host.ctx.board.info().catch(() => null) : null;
      const own = !!info && outline === info.outline && (!machine || machine === info.machine);
      return this.followTarget(own ? here : to.target, host, how);
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
      else if (p?.status === "missing") return offerPage(this.pageOffers, l.page, host);
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

  /** What soft-follow.ts works on: this reader, said narrowly. */
  private get pageOffers(): PageOfferReader { const s = this; return { get msg() { return s.msg; }, get notice() { return s.notice; }, set notice(v) { s.notice = v; }, pageOffer: s.pageOffer, runKey: (action, args, host) => s.runKey(action as "page.create", args, host), follow: (id, host, how) => s.followTarget({ block: id }, host, how) as Promise<Msg | null>, shown: (m, host, how) => s.track(() => host.navigate(m, how)) }; }

  createPage(address: string, host: SurfaceHost, actor: Actor, standing: boolean, under?: string) { return createPage(this.pageOffers, address, host, actor, standing, under); }

  /**
   * Reveal the fragment a follow left on `m`, unless it's an agent's and this is the person's focused reader.
   * A fragment link just followed (PIE-425), kept on the note object that follow handed its host: whichever
   * reader the host shows that object in (in place, a detail, a new column) reveals the fragment, once. It's
   * scoped to that navigation: another show of the same note (a refresh, another follow) is a different object.
   * `by`: whose follow it was; an agent's never scrolls or marks the reader the person has focused.
   */
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

  // ── the choice under an element: a step's status, a callout's type (PIE-472, PIE-538) ────

  /**
   * The current element is still drawn (or let go). A step that just got its id is named by it from now on;
   * until every place it's drawn has been read again (an embed a moment late) it may still be drawn under
   * its old name, and the person's `[ ]` position follows it either way.
   */
  private keepCurrent(host?: SurfaceHost) {
    const drawn = (key: string) => this.elems.some(e => e.key === key);
    // A link selected before its element is drawn (not laid out yet, or folded away) waits until it is drawn, the position
    // moves (setElem) or the note changes (letGo): a repaint that still doesn't draw it keeps it.
    const unlaid = this.cur === null ? this.pendingLink : null, e = unlaid && this.elementOfLink(unlaid);
    if (e) this.cur = e.key;
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

  // ── callouts (PIE-538) ───────────────────────────────────────────────────────
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
    return { block: ref.block, line: ref.line + 1, changed: true, header: next, revision: r.revision ?? null, recordedAs: recordedAnswer(actor) };
  }

  // ── extension undo, quote marks, dropping and materializing ──────────────────
  /** Undo (ctrl+z, `ext.undo`): the last extension action `actor` ran on this note, its write group whole (PIE-784). */
  async undoExtension(host: SurfaceHost, actor: Actor, run?: string) {
    const m = this.requireNote();
    const e = run ? { undo: run, label: "that action" } : EXT_UNDO.last(partyOf(actor), m.id);
    if (!e) throw new ActionRefused(actor.kind === "agent" ? "no extension action or quote you ran on this note to undo" : "no extension action or quote run on this note to undo");
    const say = asActor(host.ctx, actor);
    try {
      host.ctx.scriptUndos?.add(e.undo);
      const r = await host.ctx.board.undoExtension(e.undo, actor);
      if (!run) EXT_UNDO.drop(e as never);
      outlineChanged(r.written);
      // The layout the run changed goes back with its writes (PIE-957, one undo id for both): the answer says which parts were
      // undone and which were refused.
      const dispatch = host.ctx.dispatch;
      let layout: { undone: true; steps: number; screen: string; left?: string } | { refused: string } | null = null;
      if (dispatch) {
        try { const l = await dispatch.act({ action: "layout.undo", args: { txn: e.undo } }, actor) as { steps: number; screen: string; left?: string }; layout = { undone: true, steps: l.steps, screen: l.screen, ...(l.left ? { left: l.left } : {}) }; }
        catch (err) { const why = err instanceof Error ? err.message : String(err); if (!/no layout change in transaction/.test(why)) layout = { refused: why }; }
      }
      say.flash(`${"seq" in e ? undoneSaid(e as never) : `undid ${e.label.toLowerCase()}`}${layout && "refused" in layout ? ` · layout not undone: ${layout.refused}` : layout ? ` · layout restored to ${layout.screen}${layout.left ? ` · remaining: ${layout.left}` : ""}` : ""}`);
      host.redraw();
      return { undone: e.undo, action: r.action, written: r.written, ...(layout ? { layout } : {}) };
    } catch (err) {
      host.ctx.scriptUndos?.delete(e.undo);
      const why = `couldn't undo ${e.label.toLowerCase()}: ${err instanceof Error ? err.message : String(err)}`;
      // Gone from the service (undone elsewhere, or the host restarted): it can't be undone here either.
      if (!run && /No extension change/.test(why)) EXT_UNDO.drop(e as never);
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
    return { ...(opened ? { tile: opened } : {}), block: r.block.id, title: r.block.text.split("\n", 1)[0], placed: r.placement.said, parent: r.placement.parentId, marks: r.marks, ...(r.undo ? { undo: r.undo } : {}), recordedAs: recordedAnswer(actor, "new") };
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
    if (own) { const at = own.views.raw.dropAt(x, y); return at && { line: at.line, row: at.row, draft: true }; }
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

  // ── rewriting whole lines, and their undo ────────────────────────────────────
  /** Undo the last callout change `actor` made while reading this note: its header line back, if it still reads as left. */
  async undoCallout(host: SurfaceHost, actor: Actor) {
    const r = await this.inTurn(() => this.undoLines(this.calloutHistory, "callout", host, actor));
    return { block: r.block, line: r.edits[0]!.line + 1, header: r.edits[0]!.before, revision: r.revision, recordedAs: recordedAnswer(actor) };
  }

  /**
   * Lines of note `blockId` rewritten (`edits`: each line's text as it was read and what it becomes) through the
   * note's ordinary save (`update`): one change, recorded as `actor`'s, checked against the revision the service has
   * now and against each line as it was read (`stale` is said when one isn't); an agent never underneath a draft
   * someone has open on the note. Kept in `history` for undo. The callout header and the image line changes. `drawnAt`: a line the note holds twice (two fences open alike) names itself only at that revision.
   */
  private async rewriteLines(blockId: string, change: LineEdit[] | ((m: Msg) => LineEdit[]), history: UndoHistory<LineUndo>, host: SurfaceHost, actor: Actor, stale: Stale): Promise<Msg> {
    const board = host.ctx.board;
    const no = agentRefusal(actor, { board, blockId });
    if (no) throw new ActionRefused(no);
    // The note as the service has it now: each line must still read as drawn, and the save names this revision.
    const m = await board.get(blockId);
    if (!m) throw new ActionRefused("that note isn't there any more");
    if (m.revision === undefined) throw new ActionRefused("this note has no revision to check a change against; nothing was changed");
    const lines = m.text.split("\n"), edits = typeof change === "function" ? change(m) : change;
    if (edits.some(e => lines[e.line] !== e.before)) { host.ctx.flash(stale.flash); throw new ActionRefused(stale.refused, "stale-revision"); }
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
    // A picture's change follows it past an insert above it (picture.ts); any other line stays where it was.
    const at = (x: LineEdit) => (x.picture ? locatePicture(m.text, x.picture)?.line : undefined) ?? x.line;
    if (m.id !== e.block || e.edits.some(x => lines[at(x)] !== x.after) || m.revision === undefined) {
      history.drop(e);
      const why = `couldn't undo: that ${what} changed again since`; host.ctx.flash(why); throw new ActionRefused(why);
    }
    for (const x of e.edits) lines[at(x)] = x.before;
    let saved: Msg;
    try { saved = await host.ctx.board.update(m.id, lines.join("\n"), m.revision, actor); } catch (err) {
      outlineChanged([m.id]);
      const why = `couldn't undo: ${err instanceof Error ? err.message : String(err)}`; host.ctx.flash(why, undefined, errorDetails(err)); host.redraw(); throw new ActionRefused(why);
    }
    history.drop(e);
    outlineChanged([m.id]);
    if (this.msg?.id === m.id) this.refresh({ ...saved, childIds: this.msg.childIds });
    const said = undoneSaid(e);
    host.ctx.flash(said); this.noteAgent(actor, said); host.redraw();
    return { block: m.id, edits: e.edits, revision: saved.revision ?? null };
  }

  // ── checklist steps (PIE-472) and ::use ──────────────────────────────────────
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
    let said: string | undefined, link: string | undefined;
    if (choice === "copy-link" || choice === "address") {
      // The step's line, by the one owner of a line's reference (PIE-1390): the id the step was just given is its anchor, so
      // this reads it (nothing more is written) and gives what note.copy-ref kind=line gives on that line.
      const at = { blockId: ref.block, line: r.block.text.slice(0, r.item.span.start).split("\n").length - 1, revision: r.block.revision ?? 0, title, label: title };
      if (choice === "copy-link") link = (await copyLineRef(host.ctx, actor, at, msg => this.noteAgent(actor, msg))).text;
      else { link = (await lineRef(host.ctx.board, actor, at)).text; said = `made "${title}" addressable: ${link}`; }
    } else {
      if (r.changed) this.stepHistory.advance(ref.block, (r.block.revision ?? 0) - 1, r.block.revision ?? 0);
      if (r.changed && before !== choice) this.stepHistory.push({ block: ref.block, ...(r.item.itemId ? { itemId: r.item.itemId } : { at: { start: r.item.span.start, revision: r.block.revision ?? 0 } }), evidence: r.item.evidence, status: before, to: choice, title, by: partyOf(actor), context: this.msg?.id ?? ref.block });
      said = r.changed ? `set "${title}" ${statusWord(before)} → ${statusWord(choice)}${where}` : `"${title}" is already ${statusWord(choice)}`;
    }
    // An agent's host says who it is (asActor); the person's says it plainly. A copy said itself (deliverCopy).
    if (said !== undefined) { host.ctx.flash(said); this.noteAgent(actor, said); }
    host.redraw();
    return { block: ref.block, step: r.item.itemId ?? null, status: r.item.status, from: before, changed: r.changed, revision: r.block.revision ?? null, ...(link ? { link } : {}), recordedAs: recordedAnswer(actor) };
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
      return { block: whole.id, line: call.line + 1, wrote: props, stillMissing: need.filter(x => props[x.name] === undefined).map(x => x.name), revision: r.revision ?? null, recordedAs: recordedAnswer(actor) };
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

  // ── attached parts: Sources' grip, floats, hints and keys ────────────────────
  async gripSources(host: SurfaceHost) {
    const sm = this.sourcesMode;
    if (!sm) throw new ActionRefused("S opens the Sources inspector");
    if (sm.place !== "floating" && sm.place !== "tile") await this.attachments.put("sources", "floating", host);
    this.modes.push(this.gripMode(sm, "sources")); host.redraw();
    return { moving: true };
  }

  /** The attachment floating (or a popup) under `x`, `y`: the one on top. */
  floatAt(x: number, y: number, host?: SurfaceHost): AttachmentKind | null { return host?.attachment ? null : this.attachments.at(x, y); }

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
    const left = Math.max(0, cols - width(chip));
    sm.draw = { ...full, lines: full.lines.slice(top, top + room).map((l, i) => sm.view.paint(l, top + i)), hits: [
      { row: 0, from: left, to: cols, action: "placement.menu", args: { target: "sources" } },
      ...full.hits.map(x => ({ ...x, row: x.row - top + 1 })).filter(x => x.row > 0 && x.row <= room),
    ] };
    const lines = [pad("Sources", left) + fg(C.lcyan) + chip + RESET, ...sm.draw.lines];
    while (lines.length < room + 1) lines.push("");
    lines.push(...footer);
    return { lines };
  }

  attachmentHint(target: AttachmentKind): string {
    if (target === "edit-preview") return modeHint(EDIT_PREVIEW_KEYS, action => NOTE_ACTIONS.def(action));
    return this.attachedMode(target)?.hint() ?? "";
  }

  /** The reader mode that takes attachment `kind`'s keys, clicks and wheel, while it's open. */
  private attachedMode(kind: AttachmentKind) { const mode = this.attachments.def(kind).mode as ModeName | undefined; return mode ? this.modes.get(mode) : null; }

  /**
   * The keys go to attachment `target` (its tile has them, PIE-1669): its mode takes them, and every other attachment's open
   * mode that would answer a key before it (PRECEDENCE) waits, read from the attachments' own table, whichever kinds are open.
   */
  attachedKeys(target: AttachmentKind) {
    const own = this.attachedMode(target);
    if (own) this.modes.focus(own, true);
    for (const kind of this.attachments.kinds()) {
      const mode = kind === target ? null : this.attachedMode(kind);
      const d = this.attachments.def(kind);   // open as this kind: the `i` panel is the panel mode too, but no settings card
      if (mode && d.owner() && d.tileKeys() && (!own || PRECEDENCE[mode.name as ModeName] >= PRECEDENCE[own.name as ModeName])) this.modes.focus(mode, false);
    }
  }

  // ── the placement menu ───────────────────────────────────────────────────────
  private get placementMenu() { return this.modes.get("placement") as (ReaderMode<SurfaceHost> & { list: ListPicker<AttachedPlace, SurfaceHost>; target: AttachmentKind }) | null; }

  openPlacementMenu(target: AttachmentKind, host: SurfaceHost) {
    if (target === "list-preview" && host.hasWiredPreview?.()) throw new ActionRefused("the select wire places these children in its preview tile · tile.move moves that tile");
    const place = this.attachments.place(target);
    if (!place) throw new ActionRefused(`open ${target} first`);
    const chip = this.attachments.def(target).chip();
    if (!chip) throw new ActionRefused(`${target} isn't drawn here yet`);
    const list = new ListPicker<AttachedPlace, SurfaceHost>({
      name: "placement", items: () => this.attachments.choices(host),
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
    this.modes.push({ name: "placement", of: list, ...(target === "comment" && this.session ? { over: this.session } : {}), word: "placement menu", noun: "the placement menu", list, target,
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
      hint: () => `placement · ${hintOf(PLACEMENT_KEYS)}`, state: () => "placement", describe: () => ({ target, current: place }),
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
    if (direction) this.attachments.split(m.target, direction, undefined);
    this.closePlacement(host);
    return this.runKey(this.attachments.def(m.target).actions.place as keyof NoteActionArgs, { place: chosen, ...this.attachments.def(m.target).args } as never, host);
  }

  private withPlacementMenu(view: SurfaceView, w: number, h: number, where: "reader" | AttachmentKind): SurfaceView {
    const m = this.placementMenu;
    if (!m) return view;
    const place = this.attachments.place(m.target);
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
  private readSources(P: SourcesPanel, host: SurfaceHost) { return P.reading = this.readSourcesNow(P, host); }
  private async readSourcesNow(P: SourcesPanel, host: SurfaceHost) {
    P.loading = true;
    try {
      const was = P.answer?.sources[P.open ?? -1]?.key;
      P.answer = await host.ctx.board.siteSources(P.block);
      const { schemas } = await host.ctx.board.request("components.schemas", {});
      withSchemaParams(P.answer, schemas);
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
  scrollSources(host: SurfaceHost, by: number, page = false) {
    const mode = this.sourcesMode;
    if (!mode) throw new ActionRefused("the Sources inspector isn't open here · S opens it"); if (page) by = Math.sign(by) * pageRows(mode.room.h);
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
    void this.attachments.close("sources", host);
    host.redraw();
    return { closed: true };
  }

  focusSources(host: SurfaceHost, on: boolean) {
    const mode = this.sourcesMode;
    if (!mode) throw new ActionRefused("S opens the Sources inspector");
    this.modes.focus(mode, on);
    if (on) { this.attachedKeys("sources"); host.enterMode?.(); }
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
    await P?.reading;   // what a change just made is still being read: a field opened now holds the revision after it
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
      return { block, line: s.line + 1, wrote: { [key]: given }, revision: r.revision ?? null, recordedAs: recordedAnswer(actor) };
    });
    if (value !== undefined) return write(value);
    if (actor.kind !== "user") throw new ActionRefused(`give the new value: sources.set source=${source ?? "<n>"} param=${key} value=<text>`);
    return askInBar(host.ctx as never, `${s.name}: ${key}`, [{ name: "value", type: "text", label: key, ...(now ? { value: now.value } : {}) }], {}, actor, answers => write(answers.value ?? ""));
  }

  private async setFigureParam(s: SourceEntry, P: SourcesPanel | null, block: string, revision: number, param: string | undefined, value: string | undefined, host: SurfaceHost, actor: Actor) {
    const cur = P && itemsOf(s, P.folds)[P.item];
    const key = param ?? (cur?.kind === "param" ? cur.key : undefined);
    const { schemas } = await host.ctx.board.request("components.schemas", {});
    const prop = schemas.find(x => x.id === s.name)?.props.find(p => p.where === "yaml" && p.key === key);
    if (!prop) throw new ActionRefused(`choose a property of ${s.name} in Query`);
    const current = s.query.params.find(p => p.key === key)?.value ?? prop.default ?? "";
    const write = (given: string) => this.inTurn(async () => {
      const m = await host.ctx.board.get(block);
      if (!m) throw new ActionRefused("the figure note was removed · text kept");
      if (m.revision !== revision) throw new ActionRefused("the figure changed since this field opened · text kept · Esc then e reads it again");
      await this.writeFigureProperties(m, s.line, { [prop.key]: prop.type === "list" ? given || "[]" : JSON.stringify(given) }, host, actor);
      let warning = schemaCheck(prop, given);
      if (prop.type === "query") {
        try { await host.ctx.board.request("query.matches", { expression: given, blockIds: [block] }); }
        catch (e) { warning = e instanceof Error ? e.message : String(e); }
      }
      if (P) { await this.readSources(P, host); if (warning) P.warnings[prop.key] = warning; else delete P.warnings[prop.key]; P.note = warning ? `saved · ${warning}` : `saved ${prop.key} · ctrl+z undoes`; }
      this.noteAgent(actor, `set ${s.name} ${prop.key}=${given}`);
      host.ctx.flash(warning ? `saved · ${warning}` : `saved ${prop.key} · ctrl+z undoes`);
      host.redraw();
      return { block, wrote: { [prop.key]: given }, recordedAs: recordedAnswer(actor), ...(warning ? { warning } : {}) };
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

  async writeFigureProperties(m: Msg, line: number, values: Record<string, string>, host: SurfaceHost, actor: Actor) {
    const { observed, replacement, start } = figurePropertyPatch(m.text, line, values);
    await this.patchSource(m.id, m.revision!, observed, replacement, start, host, actor);
    this.sourceHistory.push({ block: m.id, edits: [{ line, before: observed, after: replacement }], patch: { start }, by: partyOf(actor), context: m.id });
    return { block: m.id, wrote: values, recordedAs: recordedAnswer(actor) };
  }

  private async patchSource(block: string, revision: number, observed: string, replacement: string, start: number, host: SurfaceHost, actor: Actor) {
    const result = await host.ctx.board.request("draft.patch", {
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
      const then = e?.then;
      const took = (r: Record<string, unknown>) => then ? this.undoPress(then, host, actor).then(back => ({ ...r, ...back })) : r;
      if (e?.patch) {
        const m = await host.ctx.board.request("drafts.read", { blockId: e.block }), edit = e.edits[0]!;
        await this.patchSource(e.block, m.revision, edit.after, edit.before, e.patch.start, host, actor);
        this.sourceHistory.drop(e);
        if (this.sourcesMode) await this.readSources(this.sourcesMode.panel, host);
        return took({ block: e.block, line: edit.line + 1, recordedAs: recordedAnswer(actor) });
      }
      const r = await this.undoLines(this.sourceHistory, "source parameter", host, actor);
      return took({ block: r.block, line: r.edits[0]!.line + 1, text: r.edits[0]!.before, revision: r.revision, recordedAs: recordedAnswer(actor) });
    });
  }

  /**
   * What a press finished by a slot's words did, taken back with them (PIE-1666): its run (ext.undo), or the layout step it took
   * while that is still the newest (layout.undo); a layout changed since is left as it is, and said.
   */
  private async undoPress(then: NonNullable<LineUndo["then"]>, host: SurfaceHost, actor: Actor): Promise<Record<string, unknown>> {
    // The words are back already: an undo of what the press did that is refused (changed since, nothing to take back) is said, not thrown.
    const kept = (e: unknown) => { const why = e instanceof Error ? e.message : String(e); asActor(host.ctx, actor).flash(`took the words back; what the press did stays: ${why}`); return { press: `kept: ${why}` }; };
    if ("run" in then) return this.undoExtension(host, actor, then.run).then(undid => ({ undid }), kept);
    if (host.layoutNewestSeq?.() !== then.layout) { host.ctx.flash("took the words back; the layout changed since, so what the press did stays · ^W B undoes the newest"); return { press: "kept: the layout changed since" }; }
    return host.ctx.dispatch!.act({ action: "layout.undo", args: { anywhere: true } }, actor).then(undid => ({ undid }), kept);
  }

  private sourcesModeOf(P: SourcesPanel, host: SurfaceHost): SourcesMode {
    const run = (name: string, args: Record<string, unknown> = {}) => { void this.runKey(name as keyof NoteActionArgs & string, args as never, host); };
    const mode: SourcesMode = {
      get keys() { return mode.view.field ? SOURCE_FIELD_KEYS : P.open === null ? SOURCES_KEYS : SOURCE_KEYS; },
      name: "sources", of: P, reveal: true, word: "sources", noun: "the sources", panel: P, holdsKeys: true, editing: () => !!P.inspector.field, covers: () => false,
      place: this.attachments.keptPlace("sources") ?? "split", float: null, frame: null, room: { w: 0, h: 0 },
      rect: { x: 0, y: 0, w: 0, h: 0 }, draw: null, view: P.inspector, footer: 0,
      changed: () => { if (!P.loading) void this.readSources(P, host); },
      key: k => {
        const binding = modeBinding(mode.keys!, k);
        if (binding) run(binding.action, { ...binding.args, ...(binding.action === "sources.refresh" ? { all: P.open === null } : {}) });
        else {
          const field = mode.view.key(k);
          if (field && field !== true) run("sources.field", field);
          else if (field) host.redraw();
        }
        return true;
      },
      click: (x, y, host) => {
        if (mode.place === "tile" && host.attachment !== "sources") return undefined;
        y += host.attachment ? 0 : this.heroTop;
        const r = mode.rect;
        // Another attachment drawn over it there takes the click (the layer's order: the last painted is on top).
        const over = this.floatAt(x, y, host);
        if (over && over !== "sources") return undefined;
        if (mode.place === "inline" && y < (this.drawn?.top ?? 0) + this.heroTop) return undefined;
        if (!inRect(r, x, y)) {
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
      wheel: (dir, host, at) => { if (mode.place === "tile" && host.attachment !== "sources") return false; const r = mode.rect; if (!at || !inRect(r, at.x, at.y)) return false; run("sources.scroll", { by: wheelRows(dir) }); return true; },
      rows: () => null, leave: async () => { this.modes.drop("sources"); return { left: "nothing" }; },
      leaveRefusal: () => mode.view.field ? `finish the property field · ${hintOf(FIELD_KEYS)}` : null,
      unsaved: () => mode.view.unsaved(), keep: () => mode.view.keep(),
      hint: () => "sources has keys · " + modeHint(mode.keys!, action => NOTE_ACTIONS.def(action)), state: () => this.modes.active(mode) ? "sources" : null,
      describe: () => ({ keys: this.modes.active(mode) ? "sources" : "reader", selectedResult: (() => { const s = P.answer?.sources[P.open ?? -1]; const it = s && itemsOf(s, P.folds)[P.item]; return it?.kind === "result" ? it.block ?? null : null; })(), place: mode.place, block: P.block, view: P.open === null ? "list" : "source", ...(P.answer ? { readAt: P.answer.readAt, sources: P.answer.sources.map((s, i) => ({ n: i + 1, name: s.name, kind: s.kind, ...(i === P.open ? { open: true, folds: { ...P.folds }, item: P.item + 1 } : {}), ...(i === P.sel ? { selected: true } : {}) })) } : {}), ...(P.error ? { error: P.error } : {}), loading: P.loading }),
    };
    return mode;
  }

  // ── ::use undo, field anchors and live rows ──────────────────────────────────
  async undoUse(host: SurfaceHost, actor: Actor) {
    const r = await this.inTurn(() => this.undoLines(this.useHistory, "::use", host, actor));
    return { block: r.block, line: r.edits[0]!.line + 1, text: r.edits[0]!.before, revision: r.revision, recordedAs: recordedAnswer(actor) };
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
    // The row's line, anchored and copied by the one owner (PIE-1390): the reference note.copy-ref gives for that line. The
    // list was drawn from the text it read; a note saved since is read again (watched), and the row anchors once it is.
    let r: Awaited<ReturnType<typeof copyLineRef>>;
    try { r = await copyLineRef(host.ctx, actor, { blockId: drawnFields.from, line: row.line, revision: drawnFields.revision }, said => this.noteAgent(actor, said)); }
    catch (e) { host.ctx.flash(e instanceof Error ? e.message : String(e), undefined, errorDetails(e)); throw e; }
    host.redraw();
    return { block: drawnFields.from, noteLine: row.line + 1, anchor: r.anchor, created: r.created, link: r.text, clipboard: r.clipboard, ...(({ recordedAs }) => (recordedAs ? { recordedAs } : {}))(r) };
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
      return { block: ref.block, step: null, status: choice, from: before, changed: w.changed, revision: w.revision, property: { key: live.key, value }, recordedAs: recordedAnswer(actor) };
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

  // ── checklist steps, continued: writing a status, its undo and naming a step ────
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
      if (!(e instanceof Refused) || ref.step.identity === "unique" || e.kind !== "moved") throw e;
      const now = await board.request("checklist.query", { blockId: ref.block, query: { limit: 1000, nested: "include" } });
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
      const said = undoneSaid(e);
      host.ctx.flash(said); this.noteAgent(actor, said); host.redraw();
      return { block: e.block, step: null, status: e.status, from: e.to, revision: w.revision, recordedAs: recordedAnswer(actor) };
    }
    // A row without an id stays at its recorded position only through our own box writes.
    const step: ChecklistStep = { ...(e.itemId ? { itemId: e.itemId } : {}), identity: e.itemId ? "unique" : "unassigned", status: e.to, evidence: e.evidence, span: { start: e.at?.start ?? 0, end: 0, startLine: 0, endLine: 0 }, depth: 0, text: e.title };
    let r: Awaited<ReturnType<SurfaceHost["ctx"]["board"]["changeStep"]>>;
    try {
      const revision = e.at?.revision ?? 0;
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
    const said = `${undoneSaid(e)}: ${statusWord(e.to)} → ${statusWord(e.status)}`;
    // An agent's host says who it is (asActor); the person's says it plainly.
    host.ctx.flash(said);
    this.noteAgent(actor, said);
    host.redraw();
    return { block: e.block, step: e.itemId ?? null, status: r.item.status, from: e.to, revision: r.block.revision ?? null, recordedAs: recordedAnswer(actor) };
  }

  /** The steps this reader draws, in reading order, as `tasks` lists them. */
  describeSteps() {
    return this.elems.filter(e => e.kind === "task" && e.task).map((e, i) => {
      const t = e.task!;
      // A live figure's row (PIE-864) is a note of its own: it has no line here.
      return { n: i + 1, id: t.step.itemId ?? null, block: t.block, in: t.live ? "a live figure" : t.via ?? "this note", status: t.step.status, text: printable(stepTitle(t.step)), line: t.live ? null : t.step.span.startLine + 1, current: e.key === this.cur };
    });
  }

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

  /** The step `n` (from `tasks`) or `id` (`t-8a6d7f`, `^t-8a6d7f`, `<block>^t-8a6d7f`; `block` narrows it) names among those drawn. */
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
    if (hit.ref && !hit.ref.via && !hit.ref.live) while (at < doc.source.length && doc.source[at] === doc.source[hit.line]) at++;
    const { lines, rows } = hit.callout ? calloutPanel(hit.callout, P, W) : pickerPanel(hit.ref!, P.list.items, P.list.sel, P.note, P.busy, W);
    const { doc: out } = withRows(doc, [{ at, lines }]);
    return { doc: out, picks: { at, lines: lines.length, rows: rows.map(r => at + r) } };
  }

  // ── revealing a fragment or a line (PIE-425) ─────────────────────────────────
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
    const read = await host.ctx.board.request("fragments.read", { blockId: m.id, fragmentId: fragment }).catch((e: Error) => ({ error: e.message }));
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
    if (!m || !isOutlineNote(m)) throw new ActionRefused("no note here to zoom into", "not-found");
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
      const r = await board.request("fragments.read", { blockId: m.id, fragmentId: at.anchor.replace(/^\^/, "") });
      if (r.status === "missing") throw new ActionRefused(`this note has no ^${at.anchor.replace(/^\^/, "")}`);
      if (r.status === "duplicate") throw new ActionRefused(`^${r.fragmentId} is in this note more than once: zoom by line= instead`);
      const f = r.fragment;
      return { start: f.startLine, end: f.endLine, line: f.startLine, kind: f.kind, label: f.label, anchor: r.fragmentId, revision: r.revision };
    }
    const line = at.line ?? this.elementLine();
    if (line === undefined) throw new ActionRefused("nothing to zoom into here: put the [ ] position or the reading line on a figure, a table or a heading");
    // Where the reader is (no line= named): the part there, else the next one, as element.detach takes it.
    const r = await board.request("fragments.at", { blockId: m.id, line, ...((at.line === undefined && !at.follow) ? { next: true } : {}) });
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
    return m ? { msg: m, position: structuredClone(this.position), cur: this.cur, folded: [...this.folded], previewLists: [...this.previewLists], previewOpen: [...this.previewOpen], expanded: [...this.expanded], foldedThreads: [...this.foldedThreads], seen: [...this.foldSeen], figures: [...this.figureUI], zoom: this.zoom } : null;
  }

  /** Track an explicit navigation once; back returns to the note and position it left. */  track<T>(open: () => T): T {
    const from = this.place(), trail = this.backs;
    // Nested navigation records once; a bounded trail that replaced backs already recorded this open.
    const outer = this.tracking++ === 0;
    let out: T;
    try { out = open(); } finally { this.tracking--; }
    if (outer && this.backs === trail && from && this.msg && this.msg.id !== from.msg.id) {
      this.backs.push(from);
      if (this.backs.length > HISTORY) this.backs.shift();
      this.aheads = [];
      this.keptChanged?.();
    }
    return out;
  }

  /** Append at the end of a bounded hover trail, even when the person has flipped back into it. */
  remember(m: Msg, host: SurfaceHost, limit: number, actor: Actor): boolean {
    const latest = this.aheads[0]?.msg ?? this.msg;
    if (latest?.id === m.id) return false;
    const here = this.place(), trail = [...this.backs, ...(here ? [here] : []), ...this.aheads.toReversed()];
    if (!this.show(m, host, actor)) return false;
    this.backs = trail.slice(-Math.max(0, limit - 1));
    if (limit === 1) this.backs = [];
    this.aheads = []; this.keptChanged?.(); return true;
  }

  /** Back (-1) or forward (1) walks this reader's own stops, not the view's trail (SurfaceHost.history). */
  travelsHere(dir: -1 | 1): boolean { return (dir < 0 ? this.backs : this.aheads).length > 0; }

  /** The title back (-1) or forward (1) would show, or null. */
  peek(dir: -1 | 1): string | null {
    const p = (dir < 0 ? this.backs : this.aheads).at(-1);
    return p ? subject(p.msg) : this.kept?.peek(dir) ?? null;
  }

  /** Walk this reader's history, keeping its position and rereading the destination. */
  async travel(dir: -1 | 1, host: SurfaceHost, actor: Actor = USER, steps = 1): Promise<string | null> {
    this.use(host);
    // `steps` stops at once (the trail's choice, PIE-208): the ones passed over go on the other stack, as one by one.
    const stack = dir < 0 ? this.backs : this.aheads, to = stack[stack.length - steps];
    if (host.history && (!stack.length || !to && dir < 0 && host.history.beneath)) return host.history.go(dir, actor, steps - stack.length);
    if (!to && stack.length) return `only ${stack.length} ${dir < 0 ? "back" : "ahead"}: steps=${stack.length} at most (trail lists them)`;
    if (!to) return dir < 0 ? "nothing to go back to: this reader hasn't followed a link here" : "nothing ahead: go back first";
    const holding = this.modes.holding();
    if (holding) return `finish ${holding} first · ${this.holdingHint()}`;
    const fresh = to.msg.id.startsWith("glass:") ? { ...to.msg, text: to.msg.id.slice(6), partial: false } : await readNote(outlineBoards(host.ctx).home(), to.msg.id, to.msg.address).catch(() => null);
    if (stack[stack.length - steps] !== to) return "the reader moved meanwhile";
    const here = this.place();
    const note = fresh ?? to.msg;
    if (host.contextFor) host = { ...host, ctx: host.contextFor(note) };
    if (!this.show(note, host, actor)) return holdsEdit("the reader");
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

  /** Remove the shown stop without adding it back to the other side of the trail. */
  async dropHere(host: SurfaceHost, actor: Actor): Promise<boolean> {
    const dir = this.backs.length ? -1 : 1;
    if (!this.travelsHere(dir)) {
      const holding = this.modes.holding();
      if (holding) throw new ActionRefused(`finish ${holding} first · ${this.holdingHint()}`);
      this.show(null, host, actor);
      this.keptChanged?.();
      return false;
    }
    const why = await this.travel(dir, host, actor);
    if (why) throw new ActionRefused(why);
    (dir < 0 ? this.aheads : this.backs).pop();
    this.keptChanged?.(); host.redraw();
    return true;
  }

  /** The reader's place and history, kept across restarts. */
  saveNav(): SavedNav | null {
    if (this.kept && !this.backs.length && !this.aheads.length) return null;
    const here = this.place();
    const out: SavedNav = { v: NAV_VERSION, ...(here ? { here: savedPlace(here) } : {}), backs: this.backs.map(savedPlace), aheads: this.aheads.map(savedPlace) };
    return here || out.backs.length || out.aheads.length ? out : null;
  }

  /** Restore the current-version history and, on the same note, its position. */
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
    Object.assign(this.position, structuredClone(to.position)); this.cur = to.cur;
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
    const trail = this.kept && !this.kept.beneath && !this.backs.length && !this.aheads.length ? this.kept.trail?.() : undefined;
    if (trail) return { back: trail.back, forward: trail.forward, keptBy: "view" };
    if (this.kept && !this.kept.beneath && !this.backs.length && !this.aheads.length) return { back: [this.kept.peek(-1)].filter(Boolean), forward: [this.kept.peek(1)].filter(Boolean), keptBy: "view" };
    const titles = (ps: Place[]) => ps.map(p => ({ ...(p.msg.address ? { address: p.msg.address } : {}), id: p.msg.id, title: subject(p.msg) })).reverse();
    return { back: [...titles(this.backs), ...(this.kept?.beneath && this.kept.trail?.().back || [])], forward: titles(this.aheads) };
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
    // A screen of tiles: a trail tile beside the reader, docked, resized and closed like any (PIE-1425); else the list over it.
    const tile = host.trailTile ? await host.trailTile() : null;
    if (tile) return { ...answer, shown: true, tile };
    if (!back.length && !forward.length) throw new ActionRefused("no trail yet: this reader hasn't followed a link (follow one, then alt+T)");
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

  clearSelections() { this.selection = null; this.agentSelection = null; this.pointer.end(); }
  // ── the mouse: press, drag and release ───────────────────────────────────────
  /** The press held here is over, with nothing fired: its release never came (the pointer moved with no button). */
  endPress() { this.pointer.end(); }

  /** The last press placed the cursor in a draft the person opened here (not an agent's): a click that enters it. */
  get pressedIntoOwn(): boolean { const w = this.editing ? this.drafting ?? this.session?.writing : null; return !!this.pointer.draft?.placed && !!w && w.openedBy.kind === "user"; }

  /**
   * The mouse button went down at `x`, `y`. Nothing happens yet (release decides: a click, or a drag that
   * selected), except a second or third press on the same cell: it selects the word, then the row.
   */
  press(x: number, y: number, host: SurfaceHost, shift = false, keepCursor = false): void {
    this.use(host);
    const pointer = this.pointer;
    // A press while another is held: that one's release never came. It's over, and this one starts clean.
    pointer.end();
    const hit = !this.draft && this.formHit(x, y);
    if (hit && "link" in hit && hit.link.form) {
      const field = hit.link.form.field, spec = this.form?.fields.find(f => f.name === field);
      if (spec && spec.type !== "choice") {
        void this.runKey("form.place", { field, col: x - hit.from, extend: shift }, host);
        pointer.clicks.press(x, y); pointer.hold({ kind: "form", shift }); return;
      }
    }
    const control = this.hitAt(x, y - this.heroTop);
    if (!this.editing && !(control && "link" in control && control.link.role === "figure") && !this.floatAt(x, y, host) && this.figureSizing.edge(x, y)) { void this.runKey("figure.resize", { phase: "start", x, y }, host); return; }
    if (this.placementMenu) { pointer.clicks.press(x, y); pointer.hold({ kind: "control" }); return; }
    // The header image (PIE-1361): its bottom row sizes it, the picture above that moves its focus.
    // Its rows as drawn: under a title written over it, the picture runs on under the title's rows.
    const heroRows = host.attachment || !(this.drawn?.heroRows) || !this.hero ? 0 : this.hero.pinned || !this.scroll ? this.hero.picture : this.drawn.heroRows;
    // A header link is a press like any link's: it opens on the release, where the click reads alt and the middle button (click).
    if (this.heroLinkAt(x, y) && !this.editing && !this.floatAt(x, y, host)) { pointer.clicks.press(x, y); pointer.hold({ kind: "text", selecting: false }); return; }
    if (!this.editing && this.hero && heroRows > 0 && y >= 0 && y < heroRows && !this.floatAt(x, y, host)) {
      const spec = this.msg && this.imagesIn(this.msg).find(r => r.line === this.hero!.line)?.spec;
      pointer.clicks.press(x, y);
      pointer.hold({ kind: "hero", part: y === heroRows - 1 ? "height" : "focus", x, y, rows: this.hero.picture, cols: this.drawn?.w ?? 80, focus: spec?.focus ?? { x: 0.5, y: 0.5 }, line: this.hero.line });
      return;
    }
    const float = this.floatAt(x, y, host);
    // A floating attachment's top edge moves it, its ◢ corner and edges size it; a split's divider sizes the split.
    const grip = float && float !== "comment" ? this.attachments.grip(x, y) : null;
    if (grip) { pointer.hold({ kind: "frame", ...grip, x, y }); return; }
    const split = !float && this.attachments.divider(x, y);
    if (split) { pointer.hold({ kind: "split", frame: split }); return; }
    const sm = this.sourcesMode, r = sm?.rect;
    if (sm && (sm.place !== "tile" || host.attachment === "sources") && r && (sm.place !== "inline" || y >= (this.drawn?.top ?? 0) + this.heroTop) && (!float || float === "sources") && inRect(r, x, y)) {
      if (y >= r.y + sm.footer) { pointer.clicks.press(x, y); pointer.hold({ kind: "control" }); return; }
      void this.runKey("sources.select", { phase: "start", row: y - r.y - 1 + sm.view.top, col: x - r.x }, host);
      pointer.hold({ kind: "sources", letGo: () => sm.view.release() });
      return;
    }
    if (float === "sources") { pointer.clicks.press(x, y); pointer.hold({ kind: "control" }); return; }
    // On a property value being typed: the line field's own press (its cursor, a word on a double click), PIE-1290.
    if (this.panel?.fieldMouse("down", x, y)) { pointer.hold({ kind: "field" }); host.redraw(); return; }
    const n = pointer.clicks.press(x, y);
    // In a draft a press puts the cursor there (shift+click: selects from where it was), a drag from it selects, a
    // double click selects the word and a triple click the line (Draft's own selection, through draft.place).
    const beside = this.attachments.besideRect;
    if (this.editing && (!this.replyParent || !beside || (x >= beside.x && y >= beside.y))) {
      // The composer is drawn in the note (PIE-770), under its header image: its cells are the note's, as a click's are.
      y -= this.heroTop;
      // `keepCursor`: the press that brought the keys back to a draft left open here (PIE-812). It still presses (a
      // frame control runs on its release), but the cursor and selection stay where the person left them.
      const d0 = keepCursor ? this.writingDraft : null;
      const kept: KeptCursor | null = d0 ? { d: d0, row: d0.row, col: d0.col, anchor: d0.anchor, follow: d0.follow } : null;
      this.writingDraft?.holdFolds(); const placed = this.modes.press(x, y, host, shift);   // drawn as it is until the release (Draft.holdFolds)
      // The floating box's frame took it (commentMode's press): no cursor moved, and it's a frame's from here.
      if (pointer.frame) return;
      if (kept) putBackCursor(kept);
      const d = this.writingDraft;
      // Beside a reply's box a press that placed nothing is the note's: a drag from it selects the note.
      if (!this.replyParent || placed) pointer.hold({ kind: "draft", placed, shift: shift && placed, kept, selecting: placed && d && n > 1 && !shift ? selectClicks(d, n, (action, args) => this.runKey(action as never, args as never, host)) : null });
      else pointer.hold({ kind: "text", selecting: false });
      if (placed) host.redraw();
      return;
    }
    const row = this.replyLinks && !this.editing ? this.replyRowAt(x, y) : null;
    pointer.hold(row?.kind === "child" ? { kind: "reply", from: { block: row.child.block, y } } : { kind: "text", selecting: false });
    if (n < 2) return;
    const rows = this.selRows(), p = this.posAt(x, y);
    if (!rows || !p || !rows.cells(p.row).length) return;
    this.selection = this.stamp(n === 2 ? wordAt(rows, p) : lineAt(rows, p.row));
    host.redraw();
  }

  /** The pointer moved with the button down: what it does is the held gesture's, and only its. */
  drag(x: number, y: number, host: SurfaceHost): void {
    const g = this.pointer.held, clicks = this.pointer.clicks;
    switch (g?.kind) {
      case "figure": void this.runKey("figure.resize", { phase: "move", x, y }, host); return;
      case "field": if (this.panel?.fieldMouse("drag", x, y)) host.redraw(); return;
      case "hero": {
        if (x === g.x && y === g.y && !g.now) return;
        clicks.drag(x, y);
        const clamp = (v: number) => Math.max(0, Math.min(1, Math.round(v * 100) / 100));
        g.now = g.part === "height"
          ? { height: Math.max(3, Math.min(this.hero?.max ?? g.rows, g.rows + y - g.y)) }
          // The picture follows the pointer: dragged right, the crop shows more of its left.
          : { focus: { x: clamp(g.focus.x - (x - g.x) / Math.max(1, g.cols)), y: clamp(g.focus.y - (y - g.y) / Math.max(1, g.rows)) } };
        host.redraw();
        return;
      }
      case "form": {
        clicks.drag(x, y);
        const hit = this.formHit(x, y);
        if (hit && "link" in hit && hit.link.form?.field === this.form?.fields[this.form.focus]?.name) void this.runKey("form.place", { field: hit.link.form!.field, col: x - hit.from, extend: true }, host);
        return;
      }
      case "split": {
        const s = g.frame;
        void this.runKey("attachment.split", { target: s.target, share: 1 - (s.beside ? x / s.w : y / s.h) }, host);
        return;
      }
      // The comment's frame was pressed in the composer's cells, under the header image.
      case "frame": this.dragFrame(g, x, g.target === "comment" ? y - this.heroTop : y, host); return;
      case "sources": {
        const sm = this.sourcesMode;
        if (sm) void this.runKey("sources.select", { phase: "drag", row: Math.max(0, y - sm.rect.y - 1) + sm.view.top, col: Math.max(0, x - sm.rect.x) }, host);
        return;
      }
      case "reply": case "control": clicks.drag(x, y); return;
      case "draft":
        clicks.drag(x, y);
        if (g.placed && this.modes.press(x, y - this.heroTop, host, true)) host.redraw();
        return;
      case "text": {
        const p = clicks.pressed;
        if (!p || !clicks.drag(x, y) || !this.drawn) return;
        if (!g.selecting) {
          // After a double or triple click, the drag extends from the word or row it selected.
          const from = p.n > 1 && this.selection ? this.selection.start : this.posAt(p.x, p.y);
          if (!from) { this.pointer.end(); return; }
          g.selecting = true;
          this.selection = this.stamp(new Selection({ ...from }, { ...from }));
        }
        const at = this.posAt(x, y, true);
        if (at && this.selection) this.selection.head = at;
        host.redraw();
        return;
      }
    }
  }

  /**
   * The button came up: the gesture ends here, whatever its kind does at the end. On the cell it went down on, with no
   * drag, a text press is a click (`click`: a link, a fold, a panel row, the copy control; anywhere else it lets go of
   * the selection). A drag, a double or a triple click keeps what it selected and copies it (copy on select,
   * selection.ts): `select.copy`, as `y` runs it. A selection of blanks, or none, copies nothing. A press with nothing
   * held (ended under it: `ReaderPointer.end`) does nothing. True when the release did something.
   */
  release(x: number, y: number, host: SurfaceHost): boolean {
    const clicks = this.pointer.clicks;
    // Its own save, which ends it: figure.resize's `end`, as an agent's act runs it.
    if (this.pointer.heldFigure) { void this.runKey("figure.resize", { phase: "end", x, y }, host); return true; }
    const at = clicks.pressed, g = this.pointer.take(), r = clicks.release(x, y);
    const still = !!at && !r.moved && at.x === x && at.y === y;
    switch (g?.kind) {
      case undefined: host.redraw(); return false;
      case "figure": return false;
      case "field": this.panel?.fieldMouse("up", x, y); host.redraw(); return true;
      case "hero": {
        if (!g.now) return still ? this.click(x, y, host) : false;
        // Drawn where it was let go until its save lands, so the header never snaps back first.
        this.pointer.land(g);
        const v = (n: number) => String(Math.round(n * 100) / 100);
        const saved = g.now.height !== undefined ? this.runKey("image.size", { line: g.line + 1, height: String(g.now.height) }, host)
          : this.runKey("image.look", { line: g.line + 1, focus: `${v(g.now.focus!.x)},${v(g.now.focus!.y)}` }, host);
        void saved.finally(() => { this.pointer.landed(g); host.redraw(); });
        host.redraw();
        return true;
      }
      case "control":
        if (this.placementMenu) return still ? this.modes.click(x, y, host) ?? false : false;
        return this.pressEnded(g, r, x, y, host);
      case "split": case "frame": host.redraw(); return true;
      case "sources": {
        const sm = this.sourcesMode;
        if (!sm) return false;
        const selected = !!sm.view.selection || sm.view.editorPressed && !!sm.view.field?.session.draft.selectedText();
        sm.view.release();
        if (selected) void this.runKey("sources.copy", {}, host);
        else this.click(x, y, host);
        return true;
      }
      case "reply": {
        if (r.click) return this.pressEnded(g, r, x, y, host);
        const row = this.replyRowAt(x, y), links = this.replyLinks;
        if (links && row?.kind === "child" && row.child.block.id !== g.from.block.id) {
          const target = row.child.block.id;
          void this.runKey("note.move", { id: g.from.block.id, revision: g.from.block.revision,
            ...(x < links.rect.x + 4 ? y > g.from.y ? { after: target } : { before: target } : { to: target }) }, host);
        }
        return true;
      }
      case "form": case "draft":
        try {
          if (g.kind === "draft" && this.listEditor.field && this.listEditor.pressed) {
            const selected = this.listEditor.editorPressed && !!this.listEditor.field.session.draft.selectedText();
            this.listEditor.release();
            if (r.click && !selected) this.click(x, y, host);
            host.redraw(); return true;
          }
          // A shift+click in a draft extended its selection: the release copies it (copy on select), never places the cursor again.
          if (g.shift) {
            const d = this.writingDraft;
            if (d?.selectedText()?.trim() && copyOnSelect()) void this.runKey("draft.copy", {}, host);
            host.redraw();
            return true;
          }
          return this.pressEnded(g, r, x, y, host);
        } finally {
          // The press that brought the keys back (PIE-812) keeps its cursor; answers it held open fold now (Draft.holdFolds).
          this.writingDraft?.letFoldsGo(); if (g.kind === "draft" && g.kept) { putBackCursor(g.kept); clicks.forget(); }
        }
      case "text": return this.pressEnded(g, r, x, y, host);
    }
  }

  /** The end of a press that may be a click or may have selected: a candidate, the click, or the copy of what it selected. */
  private pressEnded(g: ReaderGesture, r: ReturnType<ReaderPointer["clicks"]["release"]>, x: number, y: number, host: SurfaceHost): boolean {
    const completion = this.writingDraft && completerOf(this.writingDraft);
    if (completion?.click(y, x, text => host.ctx.copy?.(text, "component preview"))) {
      this.pointer.clicks.forget(); host.redraw(); return true;
    }
    if (r.click) {
      // A click that did something (a link, a fold, a panel row) isn't the first half of a double click.
      const acted = this.click(x, y, host);
      // In a draft a click only places the cursor: the next on its cell is still a double click (the word).
      if (acted && (!this.editing || this.writingDraft && completionOf(this.writingDraft))) this.pointer.clicks.forget();
      return acted;
    }
    // In a draft: the draft's own selection, copied the same way (draft.copy), when the mouse made it (a double or
    // triple click's word or line once it's selected).
    const d = g.kind === "draft" && r.copy && !(!r.moved && this.writingDraft && foldTwice(this.writingDraft)) ? this.writingDraft : null;   // a double click on an answer's row shows it (PIE-1770)
    if (d) {
      void (g.kind === "draft" && g.selecting || Promise.resolve()).then(() => { if (d.selectedText()?.trim()) void this.runKey("draft.copy", {}, host); host.redraw(); });
      return true;
    }
    const s = this.selection, rows = s && g.kind !== "draft" && r.copy ? this.selRows() : null;
    if (s && rows && s.text(rows).trim()) void this.runKey("select.copy", {}, host);
    host.redraw();
    return r.moved || r.n > 1;
  }

  // ── selecting text, continued: its control, the margin's spans and copying ────
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
    const n = [...(s.text(rows).trim() ? s.text(rows) : this.pictureSourceOf(s)?.text ?? "")].length, copy = "[y copy]", source = "[Y source]";
    // The passage toolbar goes on the line too: when it all fits beside the count and [Y source] they stay; else they
    // give it their room (Y still copies the source).
    const bar = this.msg && !this.msg.partial && s.text(rows).trim() ? this.passageChoices() : [];
    const full = width(`── ${n} chars ${copy} ${source} · `) + width(toolbarRow(bar, this.passageMenu, w).text.replace(/\x1b\[[\d;]*m/g, ""));
    const compact = bar.length > 0 && full > w;
    const lead = compact ? "" : `── ${n} chars `;
    const at = d.top - 1, wide = !compact && width(lead) + width(copy) + 1 + width(source) <= w, fits = !!lead && width(lead) + width(copy) <= w;
    const from = fits ? width(lead) : 0;
    if (width(copy) > w) return;
    this.hits.push({ row: at, from, to: from + width(copy), copy: "visible" });
    if (wide) this.hits.push({ row: at, from: from + width(copy) + 1, to: from + width(copy) + 1 + width(source), copy: "source" });
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
    if (c === "a" && s.text(rows).trim()) { this.modes.push(passageMenuMode(this as never, s)); host.redraw(); return true; }
    if (c === "y" || c === "Y") { void this.runKey("select.copy", c === "Y" ? { source: true } : {}, host); return true; }
    if (!s.keys) {
      if (c === "v") { void this.runKey("select.mode", {}, host); return true; }
      return false;
    }
    const d = this.drawn!;
    const r = modeKey(k, s, rows, d.room);
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

  /** The fence a selection with no words in it is over (PIE-1583). */
  private pictureSourceOf(s: Selection) { return this.drawn && this.msg ? pictureSourceOf(s, this.drawn, this.msg.text) : null; }

  /**
   * The note's own text behind a selection: exactly the selected words when they read the same in the
   * source (no link or formatting inside), else the whole source lines it covers. Offsets are into the
   * note's text, as the comment passage picker takes them. Null when only the header's details are selected.
   */
  sourceOf(s: Selection, noteOnly = false): { text: string; exact: boolean; from: number; to: number; lines: [number, number] } | null {
    const d = this.drawn, m = this.msg, rows = this.selRows(noteOnly);
    if (!d || !m || !rows) return null;
    const picture = !s.text(rows).trim() ? this.pictureSourceOf(s) : null;
    if (picture) return picture;
    const lines: number[] = [];
    for (let r = s.start.row; r <= s.end.row; r++) {
      // The title's rows, wrapped (PIE-815): the subject line.
      if (r >= d.titleRows[0] && r < d.titleRows[1]) lines.push(Math.max(0, titleLine(m.text).line));
      else if (r >= d.top) { const b = d.doc.source[r - d.top], l = b === undefined ? undefined : d.lines[b]; if (l !== undefined) lines.push(l); }
    }
    if (!lines.length) return null;
    const lo = Math.min(...lines), hi = Math.max(...lines), all = m.text.split("\n");
    const start = lineStart(all, lo);
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
    if (source || !text.trim() && this.pictureSourceOf(s)) {
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
    if (!m || m.revision === undefined) throw new ActionRefused("no note here to act on a passage of", "not-found");
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

  // ── act, run and describe: how the action table reaches the reader ───────────

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
      links: (sel => this.links.map((l, i) => ({ n: i + 1, ...l, reads: printable(linkText(l, this.msg?.text ?? "", this.src)), selected: i === sel })))((s => (s ? this.links.findIndex(l => l === s || sameLink(l, s)) : -1))(this.selectedLink())),
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
      steps: this.drawn || this.digesting ? { drawn: this.elems.filter(e => e.kind === "task").length, undo: this.msg ? this.stepHistory.size(this.msg.id) : 0, choosing: (this.modes.get("picker") as PickerMode | null)?.describe() ?? null } : null,
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

  // ── proposals and what's kept unsent beside the note ─────────────────────────
  /** The open proposal (PIE-501) whose embed or `[apply]` `[dismiss]` control is the current element while it's in view, if one is. */
  currentProposal(): string | undefined {
    return this.inView()?.link?.proposal?.id;
  }

  /**
   * What `R` resolves (PIE-1533): the current proposal, else the one shown, else the only one whose [resolve] is in view.
   * Several in view: `several`, and the [resolve] to offer: the first below the current element (] walked on), else the first.
   */
  resolveTarget(): { id: string } | { several: string[]; first: Element } | null {
    const m = this.msg, d = this.drawn, named = m && (this.currentProposal() ?? (isOpenProposal(m) ? m.id : undefined));
    if (!m || named) return named && this.proposalOperations(named).includes("resolve") ? { id: named } : null;
    const at = this.elems.find(e => e.key === this.cur)?.row ?? -1;
    const shown = d ? this.elems.filter(e => e.link?.proposal?.op === "resolve" && e.row - d.top >= d.scroll && e.row - d.top < d.scroll + d.room) : [];
    const ids = [...new Set(shown.map(e => e.link!.proposal!.id))];
    return ids.length === 1 ? { id: ids[0]! } : ids.length ? { several: ids, first: shown.find(e => e.row > at) ?? shown[0]! } : null;
  }

  /** Unfold the old edits on note `of` (`unsent.show`). */
  showOldUnsent(of: string) { this.oldUnsentShown.add(of); }

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
      if (last && last.reduce((n, o) => n + width(labelOf(e, o)) + 1, 0) + width(labelOf(e, op)) + 1 <= w) last.push(op); else rows.push([op]);
      return rows;
    }, []).map(r => pad(r.map(op => control(e, op)).join(""), w) + RESET);
    // Its controls after the words when both fit, else on rows of their own under them (a narrow reader).
    const wide = (e: UnsentEntry) => mine(e.ops).reduce((n, op) => n + width(labelOf(e, op)) + 1, 0);
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
      return { key, kind: "control", row: at, from: r.from, to: r.to, ruler: [at, at + 1], label: `${unsentLabel(u.op, view ? viewVerdict(of) : null)} the kept ${keptName(u.kind)}`, link: l };
    });
    return { lines, elems };
  }

  private proposalOperations(id: string) {
    if (this.msg?.id === id) return isOpenProposal(this.msg) ? proposalOps(this.msg) : [];
    return this.elems.flatMap(e => e.link?.proposal?.id === id && e.link.proposal.op ? [e.link.proposal.op] : []);
  }

  /** The keys a proposal's element offers, for the hint: `X` alone when it can't be applied (it was drawn with no `[apply]`). */
  private proposalKeys(id: string): string {
    // Each operation's key and word are its row of the reader's table (READER_KEYS: proposal.apply, …).
    return this.proposalOperations(id).map(op => { const r = READER_KEYS.find(r => r.action === `proposal.${op}`)!; return `${r.key} ${r.label} · `; }).join("");
  }

  /** The person's `A`, `X`, or a click or ⏎ on a proposal's control: `proposal.apply` or `proposal.dismiss`, its refusal flashed. */
  private proposalControl(op: "apply" | "dismiss" | "resolve", id: string | undefined, host: SurfaceHost): Promise<unknown> {
    return this.runKey(`proposal.${op}`, id ? { id } : {}, host).then(r => r ?? null);
  }

  // ── what the action table reads and asks ─────────────────────────────────────
  requireNote(): Msg {
    if (!this.msg) throw new ActionRefused("this reader shows no note; open one first", "not-found");
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
      if (s.mode === "compose" && s.target && s.target.kind !== "quote") throw new ActionRefused(`${s.target.kind === "reply" ? "a reply is being written" : "a comment is being edited"} here; ${s.target.kind === "reply" ? "send" : "save"} or close it first`);
      // `c` from the thread list, or picking again while writing: the text written so far rides along.
      await s.pick(this.commentEnv(host), s.mode === "compose");
    }
    return s;
  }

  env(host: SurfaceHost, actor: Actor) { return this.commentEnv(host, actor); }
  /** Bring the comment being written into view at the next paint (comment.place). */
  revealComposerNext() { this.revealComposer = true; this.composerAsked = this.scroll; }
  closeSession() { this.session = null; }
  /** A link with no element drawn for it (folded away, not laid out yet): followed where ⏎ on it would go. */
  followLink(l: Link, host: SurfaceHost, fresh = false) { return this.followTarget(l, host, { link: true, fresh }); }
  clearLink() { this.listAtCursor()?.view.setPick(PERSON, null); this.letGo(); } // the host's selection takes over: the [ ] position and its list's pick go (PIE-1540)
  /** Where the reader's position is (its current element) and what it folded: a host that reuses a digest keys on it. */
  get cursorKey(): string { return `${this.cur ?? ""}|${[...this.folded].join("\u0001")}|${[...this.figureUI].map(([k, v]) => `${k}=${v.tab ?? ""}/${v.density ?? ""}`).join("\u0001")}`; }
  /** The note's followable links, in order (link.follow's n=). */
  noteLinks(): readonly Link[] { return this.links; }
  /** The element the target index holds for link `l` (the one drawn as it), if any. */
  elementOfLink(l: Link, drawnOnly = false): Element | undefined { return drawnOnly && !this.drawn && !this.digesting ? undefined : this.elems.find(e => e.link === l) ?? this.elems.find(e => !!e.link && sameLink(e.link, l)); }
  /** The note's nth link (from 0) becomes the position: its element, or, until it's drawn, the element it will be. */
  selectLink(i: number) {
    const l = this.links[i];
    if (!l) throw new ActionRefused(`there is no link ${i + 1}; the note has ${this.links.length}`);
    const e = this.elementOfLink(l);
    if (e) { this.setElem(e); return; }
    this.pos = { key: null, link: l };
  }
  /** The link the position is on: the current element's, else one selected before it was drawn. */
  selectedLink(): Link | null { return (this.cur ? this.elems.find(x => x.key === this.cur)?.link : undefined) ?? this.pendingLink; }
  goUp(host: SurfaceHost) { return this.up(host); }
  /** The `[[address]]` the selected link names, for `page.create`. */
  selectedPage(): string | null { return this.selectedLink()?.page ?? null; }
}

/** The fewest rows a pane has for the reader to draw a header image above its note. */
const HERO_MIN_PANE = 16;
/** What a line change says when its line no longer reads as drawn (`flash`, `refused`), and after a conflict (`again`). */
interface Stale { flash: string; refused: string; again: string }
const CALLOUT_STALE: Stale = { flash: "that callout changed since it was drawn · nothing was changed · choose again", refused: "that callout changed since it was drawn; nothing was changed (callout.list reads it again)", again: "choose again" };
const SOURCE_STALE: Stale = { flash: "that line changed since the sources were read · nothing was changed · read them again (r)", refused: "that line changed since the sources were read; nothing was changed", again: "read the sources again (r) and retry" };
const USE_STALE: Stale = { flash: "that ::use line changed since it was drawn · nothing was changed · press again", refused: "that ::use line changed since it was drawn; nothing was changed (use.fill reads it again)", again: "press again" };
const IMAGE_STALE: Stale = { flash: "that image's line changed since it was drawn · nothing was changed · try again", refused: "that image's line changed since it was drawn; nothing was changed (images reads it again)", again: "try again" };


/** A draft's preview pictures as its frame last placed them (PIE-846), cut to the host's rows [`from`, `to`). */
const previewPictures = (d: Draft, from: number, to: number): Placement[] =>
  d.views.raw.preview ? (d.views.raw.frame?.preview?.placements ?? []).flatMap(p => inWindow(p, from, to - from, from) ?? []) : [];

/** The byline's way in to a comment on the whole note (PIE-846). */
const COMMENT_CHIP = "[comment]";
/** The header's quiet way into the Sources inspector, on a note that generates anything (PIE-956 S6b). */
const SOURCES_CHIP = "[sources]";







/** Where `quote` is in `text`: the occurrence nearest `near` (an offset), or the first; -1 when it isn't. */
function findQuote(text: string, quote: string, near?: number): number {
  // The one quote lookup (outline-core passage.ts): the first place, or the one nearest `near`.
  const at = quote ? findPassage(text, quote, { near: near ?? 0 }) : null;
  return !at || isMiss(at) ? -1 : at.start;
}

/** A block id as an agent names it: the whole id, or its first 8+ characters. */
const sameId = (named: string, id: string | undefined) => !!id && (named === id || (named.length >= 8 && id.startsWith(named)));




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

// ── the actions: NOTE_ACTIONS, split by prefix in ./note-actions/ (shared.ts holds what they share) ──────────

/** The key that starts a session in a reader: the reader table's `start` rows (READER_KEYS). */
export { sessionStart } from "./reader-keys";
/** The host an action runs on, the keys that start a session and whether they arm the edit: ./note-actions/shared.ts's. */
export { armsEdit, type On, type SessionKind } from "./note-actions/shared";

/** Each action's arguments. */
export type NoteActionArgs = ArgsOfSet<typeof NOTE_ACTIONS>;
export type ListActionName = keyof ArgsOfSet<typeof LISTVIEW_ACTIONS> & string;








/** The reader and a reader-free id call run the same proposal actions. */
export const PROPOSAL_ACTIONS = actionSet<{ surface?: NoteSurface; host: Pick<SurfaceHost, "ctx" | "redraw"> }>()("proposal", PROPOSAL_DEFS);


export const NOTE_ACTIONS = actionSet<On>()("note", {
  ...FORM_DEFS,
  ...EDIT_DEFS,
  ...REVISION_DEFS,
  ...EDIT_OPEN_DEFS,
  ...REPLY_DEFS,
  ...EDIT_SAVE_DEFS,
  ...ELEMENT_DEFS,
  ...BUTTON_DEFS,
  ...ELEMENT_OPEN_DEFS,
  ...COMMENT_DEFS,
  ...PLACEMENT_DEFS,
  ...THREAD_DEFS,
  ...MOVE_DEFS,
  ...QUOTE_DEFS,
  ...PROPS_DEFS,
  ...SETTINGS_DEFS,
  ...DECOR_DEFS,
  ...READING_DEFS,
  ...figureActions, ...dropActions,
  ...SELECT_DEFS,
  ...TASK_DEFS,
  ...CALLOUT_DEFS,
  ...IMAGE_DEFS,
  "ext.undo": def({
    summary: "undo the last extension action run on this note (PIE-784: its write group, whole: the blocks it made to the Trash, its edits, moves and orders put back), or the last quote of its marks (the quoting block to the Trash), as whoever ran it (an agent undoes its own, the person theirs); refused, with nothing changed, if any of it changed since. run=<id> takes back that run whichever came since: an agent's door action, from its done row",
    keys: readerKeys("ext.undo", { via: "when an extension action or a quote was the last change made here" }),
    touches: "nothing", replay: "ask",
    args: { run: { type: "string", optional: true, about: "the run's id: what its done row's undo carries" } },
    run: ({ run }, { surface, host }, actor) => surface.undoExtension(host, actor, run),
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
      const r = await host.ctx.board.request("scripts.stop", { run: run.trim(), mutation: requesterOf(actor) });
      asActor(host.ctx, actor).flash(r.stopped ? "stopped the script" : "that script isn't running");
      host.redraw();
      return r;
    },
  }),
  ...IMAGE_UNDO_DEFS,
  ...TASK_UNDO_DEFS,
  ...SOURCES_DEFS,
  ...USE_DEFS,
  ...PROPOSAL_DEFS,
  ...UNSENT_DEFS,
  ...EDIT_STRAYS_DEFS,
  ...SELECT_CLEAR_DEFS,
});
