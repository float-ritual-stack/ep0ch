/**
 * Tree's modes (PIE-1618): the one machine `tree-controller.ts` drives and the per-mode view `tree-renderer.ts` draws.
 * Each mode holds its own data, so leaving one takes its data with it; a menu holds the mode it opened over, whole.
 */
import type { GotoController } from "./goto-controller";
import type { NavigationDestinationPreview } from "./navigation-destination-menu";
import type { OpenDestinationTarget } from "./open-destination-chooser";
import type { OutlinerActionMenuItem } from "./outliner-actions";
import type { ReaderMenu } from "./reader-chrome";
import type { ReferenceCompletionItem } from "./reference-completion";
import type { TextBuffer } from "./text-buffer";
import type { VirtualBranchOccurrenceRow } from "./virtual-branches";
import type { Block, NavigationLinkState, TreeIndexBlock } from "./types";
import type { PaneKind } from "./ui-config";
import type { WorkspaceReport } from "./workspace-diagnostics";
export type TreeInputMode =
  | "edit"
  | "add-child"
  | "add-sibling"
  | "filter"
  | "branch-filter"
  | "goto"
  | "purge";
export type TreeQuickMode = Exclude<TreeInputMode, "goto">;
export type TreeMode = "browse" | "delete" | "viewer" | "action-menu" | TreeInputMode;

export type TreeQuickCompletionItem = ReferenceCompletionItem;

export interface TreeQuickCompletion {
  readonly start: number;
  readonly end: number;
  readonly index: number;
  readonly truncatedLimit: number | null;
  readonly message?:string;
  readonly loading?:boolean;
  readonly generation?:number;
  readonly items: readonly TreeQuickCompletionItem[];
}

/** The one-line input's text, cursor column and open completion. */
export interface TreeQuickView {
  readonly input: string;
  readonly column: number;
  readonly completion: TreeQuickCompletion | null;
}

export interface TreeViewerView {
  readonly lines: readonly string[];
  readonly path: string;
  readonly offset: number;
  readonly report: WorkspaceReport | null;
  readonly status: string;
  readonly help?: string;
}

/** The menu as the destination chooser: what its preview shows and what picking does. */
export interface TreeDestinationView {
  readonly preview: NavigationDestinationPreview;
  readonly purpose: "link" | "open" | "place";
  readonly instructions: string;
}

export interface TreeMenuView {
  readonly items: readonly OutlinerActionMenuItem[];
  readonly index: number;
  readonly query: string;
  readonly origin: { column: number; row: number } | null;
  /** Where a pin goes, what is pinned there, and the workspace line: only the full action list has them. */
  readonly pin?: { readonly bar: PaneKind; readonly pinned: ReadonlySet<string>; readonly info: string };
  readonly destination?: TreeDestinationView;
}

/** Each mode draws from its own data; the other modes' data isn't there to read (PIE-1618). */
export type TreeModeView =
  | { readonly mode: "browse" | "delete" }
  | { readonly mode: "goto"; readonly goto: GotoController }
  | { readonly mode: TreeQuickMode; readonly quick: TreeQuickView }
  | { readonly mode: "viewer"; readonly viewer: TreeViewerView }
  | { readonly mode: "action-menu"; readonly menu: TreeMenuView };

/** The workspace report is showing: a drag in it selects text to copy. */
export function treeShowsWorkspaceReport(view: TreeModeView): boolean {
  return view.mode === "viewer" && Boolean(view.viewer.report);
}

/** The full action list is open: a right-click there pins instead of opening a menu. */
export function treeMenuPinnable(view: TreeModeView): boolean {
  return view.mode === "action-menu" && Boolean(view.menu.pin);
}

/** A draft in the one-line input. A menu opened over it keeps it whole in `returnTo`. */
export interface TreeQuickDraft {
  readonly buffer: TextBuffer;
  completion: MutableQuickCompletion | null;
  /** The revision an edit began from. */
  readonly editSource: Pick<Block, "id" | "revision"> | null;
  /** A child being added under a projected occurrence. */
  readonly childDraft: { parent: VirtualBranchOccurrenceRow<TreeIndexBlock>; created?: Block; rowId?: (id: string) => string } | null;
}

export interface TreeViewerMode {
  readonly kind: "viewer";
  lines: string[];
  path: string;
  offset: number;
  wrap: boolean;
  report: WorkspaceReport | null;
  field: number;
  status: string;
}

export interface TreeDestinationContent {
  readonly kind: "destination";
  readonly state: NavigationLinkState;
  readonly purpose: "link" | "open";
  recoveryTarget?: OpenDestinationTarget;
  placing: "right" | "down" | null;
  showOther: boolean;
}

/** What the open menu lists. */
export type TreeMenuContent =
  | { readonly kind: "actions"; readonly scope: string; readonly bar: PaneKind; category: ReaderMenu }
  | { readonly kind: "selection"; readonly placement: "before" | "after" | null }
  | { readonly kind: "location"; readonly items: OutlinerActionMenuItem[] }
  | TreeDestinationContent;

export type TreeRestingMode =
  | { readonly kind: "browse" }
  | { readonly kind: "delete" }
  | { readonly kind: "goto" }
  | ({ readonly kind: TreeQuickMode } & TreeQuickDraft)
  | TreeViewerMode;

export interface TreeActionMenuMode {
  readonly kind: "action-menu";
  /** The mode it opened over, data and all. */
  readonly returnTo: TreeRestingMode;
  readonly origin: { column: number; row: number } | null;
  index: number;
  query: string;
  content: TreeMenuContent;
}

/** Tree's one machine (PIE-1618): each mode holds its own data, and a mode change is one assignment to `mode`. */
export type TreeModeState = TreeRestingMode | TreeActionMenuMode;

export const TREE_BROWSE: TreeRestingMode = { kind: "browse" };

export interface MutableQuickCompletion {
  start: number;
  end: number;
  index: number;
  items: TreeQuickCompletionItem[];
  truncatedLimit: number | null;
  message?:string;
  loading?:boolean;
  generation?:number;
}
