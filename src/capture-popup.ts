import {ReferenceCompletionSession,type ReferenceCompletionProvider} from './reference-completion';
import {COMPLETION_ROWS,renderReferenceCompletion} from './reference-completion-renderer';
import { hyperlink, truncateToWidth } from "@earendil-works/pi-tui";
import { layoutDetailEditor } from "./detail-editor-layout";
import { TextBuffer } from "./text-buffer";
import {
  applyTextBufferEditorCommand,
  renderTextBufferEditorRow,
  textBufferEditorCommand,
} from "./text-buffer-editor";
import { sanitizeDynamicText, type TerminalInputAction, type TerminalKey } from "./terminal";
import type { QuickCaptureDraft, QuickCaptureDraftSaveInput } from "./types";

export interface CapturePopupSaveInput {
  requestId: string;
  text: string;
  capturedFromBlockId?: string;
  expectedDraftRevision?: number;
}

export interface CaptureEditorResult {
  text: string;
  cleanup(): void;
  retain(): Promise<void>;
}

export type CaptureAction = "editor" | "save" | "retain" | "discard";

export interface CapturePopupEffects {
  completionProvider?: ReferenceCompletionProvider;
  editExternal?(draft: QuickCaptureDraft): Promise<CaptureEditorResult>;
  save(input: CapturePopupSaveInput): Promise<void>;
  persistDraft(input: QuickCaptureDraftSaveInput): Promise<QuickCaptureDraft>;
  clearDraft(expectedRevision: number | null): Promise<void>;
  close(): void;
  invalidate(): void;
}

export interface CapturePopupScheduler {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface CapturePopupOptions {
  requestId: string;
  workIdPrefix?: string|null;
  capturedFromBlockId?: string;
  draft?: QuickCaptureDraft;
  persistDelayMs?: number;
  scheduler?: CapturePopupScheduler;
}

const defaultScheduler: CapturePopupScheduler = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class CapturePopupController {
  readonly buffer: TextBuffer;
  readonly completions: ReferenceCompletionSession|null;
  status: string;
  saving = false;
  private closed = false;
  private requestId: string;
  private submittedText: string | undefined;
  private readonly capturedFromBlockId: string | undefined;
  private draftRevision: number | null;
  private draft: QuickCaptureDraft | undefined;
  private readonly persistDelayMs: number;
  private readonly scheduler: CapturePopupScheduler;
  private persistTimer: unknown;
  private persistenceTail: Promise<void> = Promise.resolve();
  private discardArmed = false;

  constructor(
    private readonly effects: CapturePopupEffects,
    options: CapturePopupOptions,
  ) {
    const draft = options.draft;
    this.draft = draft;
    this.requestId = draft?.requestId ?? options.requestId;
    this.submittedText = draft?.submittedText;
    this.capturedFromBlockId = draft?.capturedFromBlockId ?? options.capturedFromBlockId;
    this.draftRevision = draft?.revision ?? null;
    this.persistDelayMs = options.persistDelayMs ?? 250;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.buffer = new TextBuffer(draft?.text ?? "");
    if (draft) {
      if (draft.selectionAnchor) this.buffer.placeCursor(draft.selectionAnchor.row, draft.selectionAnchor.column);
      this.buffer.placeCursor(draft.cursorRow, draft.cursorColumn, !!draft.selectionAnchor);
    }
    this.status = draft ? "Resumed retained draft" : "";
    this.completions=effects.completionProvider?new ReferenceCompletionSession(effects.completionProvider,()=>this.buffer,()=>options.workIdPrefix??null,()=>effects.invalidate(),()=>!this.closed&&!this.saving):null;
  }

  handlePaste(text: string): void {
    if (this.closed || this.saving) return;
    this.discardArmed = false;
    this.buffer.insert(text);
    void this.completions?.refresh();
    this.scheduleDraftPersistence();
    this.effects.invalidate();
  }

  async handleKeypress(
    str: string,
    key: TerminalKey,
    inputAction: TerminalInputAction,
  ): Promise<void> {
    if (this.closed || this.saving || inputAction === "suppress") return;
    if (key.ctrl && key.name === "e") {
      await this.editExternal();
      return;
    }
    if (key.ctrl && key.name === "c") {
      await this.closeRetainingDraft();
      return;
    }
    if (key.ctrl && key.name === "d") {
      await this.confirmDiscard();
      return;
    }
    this.discardArmed = false;
    if(this.completions?.state&&!key.ctrl&&!key.meta&&!key.shift){
      if(key.name==='up'||key.name==='down'){this.completions.move(key.name==='up'?-1:1);return;}
      if((key.name==='return'||key.name==='tab')&&this.completions.state.items.length){await this.chooseCompletion();return;}
      if(key.name==='escape'){this.completions.dismiss();return;}
    }
    if(this.completions&&(key.name==='tab'||(key.ctrl&&key.name==='space'))){void this.completions.refresh();return;}
    const command = textBufferEditorCommand(
      str,
      key,
      inputAction === "modified-enter",
    );
    const result = applyTextBufferEditorCommand(this.buffer, command);
    if (result === "save") {
      await this.save();
      return;
    }
    if (result === "cancel") {
      await this.closeRetainingDraft();
      return;
    }
    if (result === "changed") this.scheduleDraftPersistence();
    void this.completions?.refresh();
    this.effects.invalidate();
  }

  async chooseCompletion(index?:number,generation?:number):Promise<void>{
    if(await this.completions?.accept(index,generation))this.scheduleDraftPersistence();
  }

  async act(action: CaptureAction): Promise<void> {
    if (this.closed || this.saving) return;
    if (action !== "discard") this.discardArmed = false;
    switch (action) {
      case "editor": await this.editExternal(); break;
      case "save": await this.save(); break;
      case "retain": await this.closeRetainingDraft(); break;
      case "discard": await this.confirmDiscard(); break;
    }
  }

  async retainDraft(): Promise<void> {
    if (this.closed) return;
    await this.flushDraft();
  }

  async prepareDraft(): Promise<QuickCaptureDraft> {
    if (this.submittedText !== undefined) throw Error("Resolve the previous Save to Inbox before opening or moving this draft");
    this.clearPersistTimer();
    await this.enqueueDraftPersistence(true);
    if (!this.draft?.blockId) throw Error("Capture preparation returned no note identity");
    return this.draft;
  }

  async editExternal(): Promise<void> {
    if (this.closed || this.saving) return;
    if (!this.effects.editExternal) {
      this.status = "External editing is unavailable in this capture surface";
      this.effects.invalidate();
      return;
    }
    this.saving = true;
    this.completions?.dismiss();
    let result: CaptureEditorResult | undefined;
    try {
      const draft = await this.prepareDraft();
      result = await this.effects.editExternal(draft);
      this.buffer.replaceText(result.text);
      this.buffer.placeCursor(draft.cursorRow, draft.cursorColumn);
      await this.flushDraft();
      result.cleanup();
      result = undefined;
      this.status = "Writing retained · Ctrl+S Save to Inbox when ready";
    } catch (error) {
      this.status = `Editor: ${error instanceof Error ? error.message : String(error)}`;
      if (result) {
        try {
          await result.retain();
          this.status += " · Writing retained in note history";
        } catch (retentionError) {
          this.status += ` · Recovery file retained: ${retentionError instanceof Error ? retentionError.message : String(retentionError)}`;
        }
      }
    } finally {
      this.saving = false;
      this.effects.invalidate();
    }
  }

  async closeRetainingDraft(): Promise<void> {
    if (this.closed) return;
    try {
      await this.flushDraft();
      this.closed = true;
      this.effects.close();
    } catch (error) {
      this.status = `Draft retain failed: ${error instanceof Error ? error.message : String(error)}`;
      this.effects.invalidate();
    }
  }

  private scheduleDraftPersistence(): void {
    this.clearPersistTimer();
    this.persistTimer = this.scheduler.set(() => {
      this.persistTimer = undefined;
      void this.enqueueDraftPersistence().catch(() => {});
    }, this.persistDelayMs);
  }

  private enqueueDraftPersistence(prepareBlock = false): Promise<void> {
    const text = this.buffer.text;
    const requestId = this.requestId;
    const submittedText = this.submittedText;
    const cursorRow = this.buffer.row;
    const cursorColumn = this.buffer.column;
    const selection = this.buffer.selectionRange;
    const selectionAnchor = selection
      ? selection.start.row === cursorRow && selection.start.column === cursorColumn ? selection.end : selection.start
      : undefined;
    const operation = this.persistenceTail.then(async () => {
      if (!text.trim() && submittedText === undefined && !prepareBlock && !this.draft?.blockId) {
        if (this.draftRevision !== null) {
          await this.effects.clearDraft(this.draftRevision);
          this.draftRevision = null;
          this.draft = undefined;
        }
        return;
      }
      const draft = await this.effects.persistDraft({
        requestId,
        text,
        ...(submittedText === undefined ? {} : { submittedText }),
        cursorRow,
        cursorColumn,
        ...(selectionAnchor ? {selectionAnchor} : {}),
        ...(prepareBlock ? {prepareBlock: true} : {}),
        ...(this.capturedFromBlockId
          ? { capturedFromBlockId: this.capturedFromBlockId }
          : {}),
        expectedRevision: this.draftRevision,
      });
      this.draftRevision = draft.revision;
      this.draft = draft;
    });
    this.persistenceTail = operation.catch((error) => {
      this.status = `Draft retain failed: ${error instanceof Error ? error.message : String(error)}`;
      this.effects.invalidate();
    });
    return operation;
  }

  private async flushDraft(): Promise<void> {
    this.clearPersistTimer();
    await this.enqueueDraftPersistence();
  }

  private clearPersistTimer(): void {
    if (this.persistTimer === undefined) return;
    this.scheduler.clear(this.persistTimer);
    this.persistTimer = undefined;
  }

  private async confirmDiscard(): Promise<void> {
    if (!this.buffer.text.trim() && this.draftRevision === null) {
      this.closed = true;
      this.effects.close();
      return;
    }
    if (!this.discardArmed) {
      this.discardArmed = true;
      this.status = "Press Ctrl+D again to discard this draft";
      this.effects.invalidate();
      return;
    }
    this.clearPersistTimer();
    await this.persistenceTail;
    try {
      await this.effects.clearDraft(this.draftRevision);
      this.draftRevision = null;
      this.closed = true;
      this.effects.close();
    } catch (error) {
      this.discardArmed = false;
      this.status = `Discard failed: ${error instanceof Error ? error.message : String(error)}`;
      this.effects.invalidate();
    }
  }

  private async save(): Promise<void> {
    const text = this.draft?.blockId ? this.buffer.text : this.buffer.text.trim();
    if (!text.trim() && this.submittedText === undefined) {
      this.status = "Capture text cannot be empty";
      this.effects.invalidate();
      return;
    }
    this.saving = true;
    this.status = "Saving…";
    this.effects.invalidate();
    let captured = false;
    try {
      this.submittedText ??= text;
      await this.flushDraft();
      await this.effects.save({
        requestId: this.requestId,
        text: this.submittedText,
        capturedFromBlockId: this.capturedFromBlockId,
        ...(this.draft?.blockId ? {expectedDraftRevision: this.draftRevision!} : {}),
      });
      captured = true;
      if (text && text !== this.submittedText) {
        const previousRequestId = this.requestId;
        const previousSubmittedText = this.submittedText;
        this.requestId = crypto.randomUUID();
        this.submittedText = undefined;
        try {
          await this.flushDraft();
        } catch (error) {
          this.requestId = previousRequestId;
          this.submittedText = previousSubmittedText;
          throw error;
        }
        this.saving = false;
        this.status = "Previous capture saved; changed draft retained. Ctrl+S to capture it.";
        this.effects.invalidate();
        return;
      }
      await this.effects.clearDraft(this.draftRevision);
      this.draftRevision = null;
      this.closed = true;
      this.effects.close();
    } catch (error) {
      this.saving = false;
      this.status = captured
        ? `Capture saved; draft cleanup failed: ${error instanceof Error ? error.message : String(error)}`
        : `Capture failed: ${error instanceof Error ? error.message : String(error)}`;
      this.effects.invalidate();
    }
  }
}

export function renderCapturePopupFrame(
  controller: CapturePopupController,
  width: number,
  height: number,
): string {
  const frameWidth = Math.max(1, Math.floor(width));
  const frameHeight = Math.max(1, Math.floor(height));
  const available=Math.max(1,frameHeight-4);
  const completion=controller.completions?.state;
  const completionHeight=completion?Math.min(COMPLETION_ROWS,Math.max(0,available-1)):0;
  const bodyHeight = Math.max(1, available-completionHeight);
  const layout = layoutDetailEditor(
    controller.buffer.lines,
    controller.buffer.row,
    controller.buffer.column,
    frameWidth,
  );
  const firstVisibleRow = Math.max(
    0,
    Math.min(
      layout.cursorRow - Math.floor(bodyHeight / 2),
      Math.max(0, layout.rows.length - bodyHeight),
    ),
  );
  const output = [
    `\x1b[1m${truncateToWidth(
      `Quick capture · Inbox · line ${controller.buffer.row + 1}/${controller.buffer.lines.length}`,
      frameWidth,
      "…",
    )}\x1b[0m`,
    truncateToWidth([
      ["editor", "[Editor ^E]"], ["save", "[Save to Inbox]"],
      ["retain", "[Retain]"], ["discard", "[Discard]"],
    ].map(([action, label]) => hyperlink(label!, `pi-outliner-action:capture.${action}`)).join(" "), frameWidth),
  ];
  const editorRows=completion?Math.min(bodyHeight,layout.cursorRow-firstVisibleRow+1):bodyHeight;
  for (let offset = 0; offset < editorRows; offset += 1) {
    const visualRow = firstVisibleRow + offset;
    const row = layout.rows[visualRow];
    output.push(
      row
        ? truncateToWidth(renderTextBufferEditorRow(layout, row, visualRow), frameWidth)
        : "",
    );
  }
  if(completion)output.push(...renderReferenceCompletion(completion,frameWidth,completionHeight));
  while(output.length<frameHeight-2)output.push("");
  const status = controller.status || "Draft retained automatically";
  output.push(truncateToWidth(sanitizeDynamicText(status), frameWidth, "…"));
  output.push(
    `\x1b[2m${truncateToWidth(
      "Enter newline · Ctrl+S save · Esc retain · Ctrl+D discard",
      frameWidth,
      "…",
    )}\x1b[0m`,
  );
  return `\x1b[H\x1b[2J${output.slice(0, frameHeight).join("\n")}`;
}
