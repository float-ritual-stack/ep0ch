import {
  Markdown,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  type MarkdownTheme,
} from "@earendil-works/pi-tui";
import {
  detailMarkdownPresentation,
  sanitizeMarkdownDocument,
} from "./detail-pi-preview";
import {
  createOpenDestinationChooserState,
  openDestinationBlockId,
  OpenDestinationChooser,
  type OpenDestinationControl,
} from "./open-destination-chooser";
import { parseTreePrimaryClick, parseTreeWheelEvent, treeClickActivates } from "./tree-mouse";
import {
  DEFAULT_OUTLINER_ACTION_KEYMAP,
  displayActionChord,
  type OutlinerActionKeymap,
} from "./outliner-actions";
import type { TerminalInputAction, TerminalKey } from "./terminal";
import type { BacklinkViewOptions } from "./backlink-view";
import type { BacklinkSource, Block } from "./types";

export interface BacklinkPeekLaunch {
  sourceClientId: string;
  browsingContextId: string;
  targetBlockId: string;
  selectedSourceBlockId: string;
  view: BacklinkViewOptions;
}

export interface BacklinkPeekPreview {
  block: Block;
  text: string;
  sourceLine: number;
}


export interface BacklinkPeekEffects {
  loadSource(source: BacklinkSource): Promise<BacklinkPeekPreview>;
  restoreSelection(sourceBlockId: string): Promise<void>;
  replaceSource(sourceBlockId: string): Promise<void>;
  openLinked(sourceBlockId: string): Promise<boolean>;
  openInNewDetail(
    sourceBlockId: string,
    direction: "right" | "down",
  ): Promise<void>;
  close(): void;
  invalidate(): void;
}
export interface BacklinkPeekOptions {
  destinationTimeoutMs?: number;
  actionKeymap?: OutlinerActionKeymap;
}


export class BacklinkPeekController {
  selectedIndex: number;
  preview: BacklinkPeekPreview | null = null;
  scrollOffset = 0;
  status = "";
  loading = false;
  readonly destinationChooserState = createOpenDestinationChooserState();
  private readonly destinationChooser: OpenDestinationChooser;
  private readonly actionKeymap: OutlinerActionKeymap;
  private closed = false;

  constructor(
    readonly targetBlockId: string,
    readonly sources: readonly BacklinkSource[],
    selectedSourceBlockId: string,
    private readonly effects: BacklinkPeekEffects,
    options: BacklinkPeekOptions = {},
  ) {
    const selectedIndex = sources.findIndex((source) => source.blockId === selectedSourceBlockId);
    this.selectedIndex = selectedIndex < 0 ? 0 : selectedIndex;
    this.actionKeymap = options.actionKeymap ?? DEFAULT_OUTLINER_ACTION_KEYMAP;
    this.destinationChooser = new OpenDestinationChooser({
      beforeOpen: async (target, destination) => {
        if (destination !== "replace") {
          await effects.restoreSelection(openDestinationBlockId(target));
        }
      },
      replace: (target) => effects.replaceSource(openDestinationBlockId(target)),
      openLinked: (target) =>
        effects.openLinked(openDestinationBlockId(target)),
      openNewDetail: (target, direction) =>
        effects.openInNewDetail(openDestinationBlockId(target), direction),
      opened: () => {
        this.closed = true;
        effects.close();
      },
      invalidate: () => {
        this.status = this.destinationChooserState.status;
        effects.invalidate();
      },
    }, {
      state: this.destinationChooserState,
      ...(options.destinationTimeoutMs === undefined
        ? {}
        : { timeoutMs: options.destinationTimeoutMs }),
      actionKeymap: this.actionKeymap,
    });
  }

  get selectedSource(): BacklinkSource | undefined {
    return this.sources[this.selectedIndex];
  }

  get destinationChooserOpen(): boolean {
    return this.destinationChooserState.active;
  }

  /** The help row's controls: the chooser's while it is open, else the peek's own. A click on one presses its key. */
  get helpControls(): readonly OpenDestinationControl[] {
    if (this.destinationChooserState.active) return this.destinationChooser.helpControls();
    const right = this.actionKeymap.defaultInput("detail.pane.right");
    const down = this.actionKeymap.defaultInput("detail.pane.below");
    return [
      { label: "Esc cancel", str: "", key: { name: "escape" } },
      { label: "← prev", str: "", key: { name: "left" } },
      { label: "→ next", str: "", key: { name: "right" } },
      { label: "↑/↓ scroll", str: "", key: {} },
      ...(right ? [{ label: `${displayActionChord(this.actionKeymap.primaryBinding("detail.pane.right"))} right`, ...right }] : []),
      ...(down ? [{ label: `${displayActionChord(this.actionKeymap.primaryBinding("detail.pane.below"))} down`, ...down }] : []),
      { label: "Enter choose destination", str: "\r", key: { name: "return" } },
    ];
  }

  /** The title row's controls: ‹ and › peek the other backlinks, the rest is the backlink (Enter). */
  get titleControls(): readonly OpenDestinationControl[] {
    const source = this.selectedSource;
    const open = { str: "\r", key: { name: "return" } };
    return [
      { label: "‹", str: "", key: { name: "left" } },
      { label: source ? `Backlink ${this.selectedIndex + 1}/${this.sources.length}` : "Backlink peek", ...open },
      { label: "›", str: "", key: { name: "right" } },
      { label: source?.title ?? "No source", ...open },
    ];
  }

  /**
   * A click or the wheel, at the rows and columns `renderBacklinkPeekFrame` drew at `width` × `height`: the wheel
   * scrolls the preview, a click on a title or help control presses its key (the same path as typing it), a click
   * on the summary row or a Ctrl/⌘-click in the preview opens the chooser (Enter), and a plain click there does
   * nothing.
   */
  async handleMouse(sequence: string, width: number, height: number): Promise<void> {
    if (this.closed) return;
    const wheel = parseTreeWheelEvent(sequence);
    if (wheel) {
      if (this.destinationChooserState.active) return;
      this.scrollBy(wheel.direction === "up" ? -3 : 3);
      this.effects.invalidate();
      return;
    }
    const click = parseTreePrimaryClick(sequence);
    if (!click) return;
    const layout = backlinkPeekLayout(height);
    const press = (control: OpenDestinationControl | undefined) => control && (control.key.name || control.str)
      ? this.handleKeypress(control.str, control.key, "pass", height)
      : undefined;
    if (click.row === layout.titleRow) await press(controlAt(this.titleControls, TITLE_GAP, click.column, width));
    else if (click.row === layout.helpRow) await press(controlAt(this.helpControls, HELP_GAP, click.column, width));
    else if (click.row === layout.summaryRow || (click.row >= layout.bodyTop && click.row < layout.bodyTop + layout.bodyHeight && treeClickActivates(click))) {
      await this.handleKeypress("\r", { name: "return" }, "pass", height);
    }
  }

  async initialize(): Promise<void> {
    await this.loadSelected();
  }

  async handleKeypress(
    str: string,
    key: TerminalKey,
    inputAction: TerminalInputAction,
    viewportHeight: number,
  ): Promise<void> {
    if (this.closed || inputAction === "suppress") return;
    if (key.ctrl && key.name === "c") {
      await this.cancel();
      return;
    }
    if (this.destinationChooserState.active) {
      await this.destinationChooser.handleKeypress(str, key);
      return;
    }
    const directional = this.actionKeymap.canonicalize("detail", "destination", str, key);
    if (
      directional.actionId === "detail.pane.right" ||
      directional.actionId === "detail.pane.below"
    ) {
      const source = this.selectedSource;
      if (source) {
        this.destinationChooser.open({
          target: { kind: "block", blockId: source.blockId },
          title: source.title,
        });
        await this.destinationChooser.handleKeypress(str, key);
      }
      return;
    }
    if (str === "q") {
      await this.cancel();
      return;
    }
    if (key.name === "escape") {
      await this.cancel();
      return;
    }
    if (this.loading) return;
    if (key.name === "left") {
      await this.move(-1);
      return;
    }
    if (key.name === "right") {
      await this.move(1);
      return;
    }
    if (key.name === "return") {
      const source = this.selectedSource;
      if (source) {
        this.destinationChooser.open({
          target: { kind: "block", blockId: source.blockId },
          title: source.title,
        });
      }
      return;
    }
    const page = Math.max(1, viewportHeight - 6);
    if (key.name === "up") this.scrollBy(-1);
    else if (key.name === "down") this.scrollBy(1);
    else if (key.name === "pageup") this.scrollBy(-page);
    else if (key.name === "pagedown") this.scrollBy(page);
    else if (key.name === "home") this.scrollOffset = 0;
    else return;
    this.effects.invalidate();
  }

  async move(delta: -1 | 1): Promise<void> {
    const next = this.selectedIndex + delta;
    if (next < 0 || next >= this.sources.length) {
      this.status = delta < 0 ? "First backlink source" : "Last backlink source";
      this.effects.invalidate();
      return;
    }
    this.selectedIndex = next;
    await this.loadSelected();
  }

  private scrollBy(delta: number): void {
    this.scrollOffset = Math.max(0, this.scrollOffset + delta);
  }

  private async loadSelected(): Promise<void> {
    const source = this.selectedSource;
    if (!source) {
      this.preview = null;
      this.status = "No backlink source is available";
      this.effects.invalidate();
      return;
    }
    this.loading = true;
    this.status = `Loading ${source.title}…`;
    this.effects.invalidate();
    try {
      this.preview = await this.effects.loadSource(source);
      this.scrollOffset = Math.max(0, this.preview.sourceLine - 2);
      this.status = "";
    } catch (error) {
      this.preview = null;
      this.scrollOffset = 0;
      this.status = `Preview failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.loading = false;
      this.effects.invalidate();
    }
  }

  private async cancel(): Promise<void> {
    const source = this.selectedSource;
    this.destinationChooser.dispose();
    this.closed = true;
    if (source) {
      try {
        await this.effects.restoreSelection(source.blockId);
      } catch {
        // Closing the popup remains available after the source Detail disappears.
      }
    }
    this.effects.close();
  }

}

const TITLE_GAP = " ", HELP_GAP = "  ";

/** Where the peek's rows are at `height`: the title, the summary, the rule, the preview, the status, the help row. */
function backlinkPeekLayout(height: number) {
  const bodyHeight = Math.max(1, height - 6);
  return { titleRow: 0, summaryRow: 1, bodyTop: 3, bodyHeight, helpRow: Math.max(3 + bodyHeight, height - 1) };
}

/** Controls drawn in order with `gap` between them, cut at `width`. */
function controlRow(controls: readonly OpenDestinationControl[], gap: string, width: number): string {
  return truncateToWidth(controls.map(control => control.label).join(gap), width);
}

function controlAt(controls: readonly OpenDestinationControl[], gap: string, column: number, width: number): OpenDestinationControl | undefined {
  let start = 0;
  for (const control of controls) {
    const end = start + visibleWidth(control.label);
    if (start >= width) return undefined;
    if (column >= start && column < end) return control;
    start = end + visibleWidth(gap);
  }
  return undefined;
}

function occurrenceSummary(source: BacklinkSource): string {
  const count = source.occurrenceCount === 1 ? "1 reference" : `${source.occurrenceCount} references`;
  return `${source.parentContext} · ${count}`;
}

export function renderBacklinkPeekFrame(
  controller: Readonly<BacklinkPeekController>,
  width: number,
  height: number,
  theme: MarkdownTheme,
): string {
  const source = controller.selectedSource;
  const layout = backlinkPeekLayout(height);
  const [prev, position, next, title] = controller.titleControls.map(control => control.label);
  // Drawn from titleControls, so a click finds each label at the column it was drawn in.
  const titleRow = `\x1b[2m${prev}\x1b[0m${TITLE_GAP}\x1b[1;36m${position}\x1b[0m${TITLE_GAP}\x1b[2m${next}\x1b[0m${TITLE_GAP}${title}`;
  const output = [`\x1b[H\x1b[2J${truncateToWidth(titleRow, width)}`];
  output.push(truncateToWidth(`\x1b[2m${source ? occurrenceSummary(source) : controller.targetBlockId}\x1b[0m`, width));
  output.push("─".repeat(Math.max(1, width)));

  const bodyHeight = layout.bodyHeight;
  const previewText = controller.preview?.text ?? "_No preview available._";
  const markdown = new Markdown(
    detailMarkdownPresentation(sanitizeMarkdownDocument(previewText)),
    0,
    0,
    theme,
  );
  const rendered = markdown.render(Math.max(1, width));
  output.push(...rendered.slice(controller.scrollOffset, controller.scrollOffset + bodyHeight));
  while (output.length < height - 2) output.push("");
  const status = controller.destinationChooserState.active
    ? controller.destinationChooserState.status
    : controller.loading
    ? controller.status || "Loading…"
    : controller.status;
  output.push(truncateToWidth(`\x1b[2m${stripTerminalSequences(status)}\x1b[0m`, width));
  output.push(controlRow(controller.helpControls, HELP_GAP, width));
  return output.join("\n");
}
