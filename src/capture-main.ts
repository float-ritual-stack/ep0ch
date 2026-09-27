import {initTheme} from "@earendil-works/pi-coding-agent";
import {attachCaptureInput} from './capture-input';
import {referenceCompletionProvider} from './reference-completion';
import {parseTreePlainClick,treeLinkAtClick} from './tree-mouse';
import { pluginInvocationPaneId, reportCurrentPaneWorkspace } from "./pane-control";
import { createOutlinerClient } from "./client";
import {
  CapturePopupController,
  renderCapturePopupFrame,
  type CaptureAction,
} from "./capture-popup";
import {EditRecoveryClient, EditRecoveryRetainedLocallyError} from "./edit-recovery-client";
import {EditRecoveryReview, type RecoveryChoice} from "./edit-recovery-review";
import {resolveExternalEditorConfiguration} from "./external-editor";
import {acceptCaptureHandoff, confirmCaptureHandoff, loadCaptureHandoff, openCaptureSurface} from "./capture-surface";
import { resolveClientPaths } from "./paths";
import {
  BRACKETED_PASTE_DISABLE,
  BRACKETED_PASTE_ENABLE,
} from "./terminal";
import type { Block, QuickCaptureDraft, WorkIdAllocatorStatus } from "./types";

if (process.env.HERDR_ENV !== "1") {
  throw new Error("Quick capture popup requires Herdr");
}

initTheme(undefined, false);
const paths = resolveClientPaths();
reportCurrentPaneWorkspace(paths.workspaceRoot);
const client = createOutlinerClient(paths);
await client.requireCompatibleService();
const recovery = new EditRecoveryClient(client, paths.stateDir);
const requestId = process.env.OUTLINER_CAPTURE_REQUEST_ID?.trim() || crypto.randomUUID();
const capturedFromBlockId = process.env.OUTLINER_CAPTURE_FROM_BLOCK_ID?.trim() || undefined;
const draft = await client.request<QuickCaptureDraft | null>({ action: "capture.draft.get" });
const retainedWriting = draft?.blockId ? await recovery.list(draft.blockId) : [];
const handoffDirectory = process.env.OUTLINER_CAPTURE_HANDOFF;
const handoff = handoffDirectory ? await loadCaptureHandoff(handoffDirectory) : undefined;
const originPaneId = handoff?.originPaneId ?? process.env.OUTLINER_CAPTURE_ORIGIN_PANE ?? pluginInvocationPaneId();
const workIds=await client.request<WorkIdAllocatorStatus>({action:'work-ids.status'});
let detachInput:(()=>void)|undefined;
let renderedLines:string[]=[];
let stopping = false;
let workQueue = Promise.resolve();
let writingReview: EditRecoveryReview | undefined;

function stop(exitCode = 0): void {
  if (stopping) return;
  stopping = true;
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdout.off("resize", draw);
  detachInput?.();
  process.stdout.write(`${BRACKETED_PASTE_DISABLE}\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l`);
  process.exit(exitCode);
}

let shutdownRequested = false;
function stopAfterRetainingDraft(exitCode: number): void {
  if (shutdownRequested || stopping) return;
  shutdownRequested = true;
  writingReview?.dismiss();
  workQueue = workQueue
    .then(() => controller.retainDraft())
    .finally(() => stop(exitCode));
}

const controller = new CapturePopupController({
  completionProvider:referenceCompletionProvider(client,"capture"),
  async save(input) {
    await client.request({
      action: "capture.create",
      requestId: input.requestId,
      text: input.text,
      source: "tree",
      capturedFromBlockId: input.capturedFromBlockId,
      author: "user",
      expectedDraftRevision: input.expectedDraftRevision,
    });
  },
  async persistDraft(input) {
    return await client.request<QuickCaptureDraft>({
      action: "capture.draft.save",
      input,
    });
  },
  async clearDraft(expectedRevision) {
    await client.request({
      action: "capture.draft.clear",
      expectedRevision,
    });
  },
  async editExternal(draft) {
    if (!draft.blockId || !draft.blockRevision) throw Error("Prepare the capture before editing");
    const configuration = resolveExternalEditorConfiguration();
    try {
      const result = await recovery.files.edit({
        blockId: draft.blockId, baseText: draft.text, expectedRevision: draft.blockRevision, text: draft.text,
      }, {
        ...configuration,
        cwd: paths.workspaceRoot,
        suspendTerminal() {
          detachInput?.();
          detachInput = undefined;
          process.stdin.pause();
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stdout.off("resize", draw);
          process.stdout.write(`${BRACKETED_PASTE_DISABLE}\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l`);
        },
        restoreTerminal() {
          startInput();
          process.stdout.on("resize", draw);
          draw();
        },
        async currentRevision() { return String(draft.blockRevision); },
      });
      return {
        text: result.text,
        cleanup: result.cleanup,
        async retain() { await recovery.retain(result.recoveryInput); result.cleanup(); },
      };
    } catch (error) {
      // Import any returned/failed editor journal without changing the note.
      // A dead process's journal is also recovered by the existing Detail history.
      await recovery.list(draft.blockId).catch(() => {});
      throw error;
    }
  },
  async relocate(placement, draft) {
    if (!originPaneId) throw Error("The originating Herdr pane is unavailable");
    await openCaptureSurface(client, {workspaceRoot: paths.workspaceRoot, stateDir: paths.stateDir,
      draft, originPaneId, placement});
  },
  async retainWriting(draft, text) {
    try {
      await recovery.retain({id: crypto.randomUUID(), blockId: draft.blockId!,
        baseText: draft.text, baseRevision: draft.blockRevision!, prelaunchText: draft.text,
        draftText: text, source: "save-conflict"});
    } catch (error) {
      if (!(error instanceof EditRecoveryRetainedLocallyError)) throw error;
    }
  },
  async reviewWriting(draft, text) {
    let records = await recovery.list(draft.blockId!, true);
    const latest = await client.request<Block>({action: "get", blockId: draft.blockId!});
    if ((text !== draft.text || latest.revision !== draft.blockRevision) &&
      !records.some(r => r.state === "retained" && r.baseRevision === draft.blockRevision && r.draftText === text)) {
      records = [await recovery.retain({id: crypto.randomUUID(), blockId: draft.blockId!,
        baseText: draft.text, baseRevision: draft.blockRevision!, prelaunchText: draft.text,
        draftText: text, source: "save-conflict"}), ...records];
    }
    if (!records.length) return {message: recovery.warnings.join(" · ") || "No retained writing for this capture"};
    const choice = await new Promise<RecoveryChoice>(resolve => {
      writingReview = new EditRecoveryReview(records, recovery, draw, result => {
        writingReview = undefined;
        resolve(result);
      }, recovery.warnings);
      draw();
    });
    if (choice.action === "later") return {message: "Writing history closed; capture unchanged"};
    if (choice.action === "separate") {
      const note = await recovery.separate(choice.record);
      return {message: `Recovered writing saved separately: ((${note.id})) · capture unchanged`};
    }
    return {text: choice.action === "proposal" ? choice.record.proposal!.text : choice.record.draftText,
      recovery: {id: choice.record.id, revision: choice.record.revision, basedOnBlockRevision: choice.record.latest.revision}};
  },
  close() {
    stop();
  },
  invalidate() {
    draw();
  },
}, {
  requestId,
  workIdPrefix:workIds.prefix,
  capturedFromBlockId,
  draft: draft ?? undefined,
  placement: handoff?.placement,
});
if (retainedWriting.length) controller.status = `${retainedWriting.length} retained writing draft(s) · History / Ctrl+R to review`;

function draw(): void {
  const width = process.stdout.columns ?? 80, height = process.stdout.rows ?? 20;
  const frame=writingReview ? `\x1b[H\x1b[2J${writingReview.render(width, height).join("\n")}` : renderCapturePopupFrame(
    controller,
    width,
    height,
  );
  renderedLines=frame.replace(/^\x1b\[H\x1b\[2J/,"").split("\n");
  process.stdout.write(frame);
}

function enqueueWork(task: () => void | Promise<void>): void {
  workQueue = workQueue.then(task).catch((error) => {
    controller.status = error instanceof Error ? error.message : String(error);
    draw();
  });
}

function startInput(): void {
 if (process.stdin.isTTY) process.stdin.setRawMode(true);
 process.stdout.write(`\x1b[?1049h\x1b[?25l${BRACKETED_PASTE_ENABLE}\x1b[?1000h\x1b[?1006h`);
 detachInput=attachCaptureInput(process.stdin,{
 keypress:(text,key,action)=>writingReview ? writingReview.key(text,key) : enqueueWork(()=>controller.handleKeypress(text,key,action)),
 paste:text=>{if (!writingReview) enqueueWork(()=>controller.handlePaste(text));},
 mouse:sequence=>{
  if(!parseTreePlainClick(sequence))return;
  const uri=treeLinkAtClick(renderedLines,sequence);
  if (writingReview) {
    if (uri?.startsWith("pi-outliner-action:recovery.")) void writingReview.action(uri.slice("pi-outliner-action:recovery.".length));
    return;
  }
  const match=uri?.match(/^pi-outliner-action:completion.choose:(\d+):(\d+)$/);
  if(match)enqueueWork(()=>controller.chooseCompletion(Number(match[1]),Number(match[2])));
  const action=uri?.match(/^pi-outliner-action:capture\.(editor|save|retain|discard|history|dock|left|right|bottom|popup)$/)?.[1];
  if(action)enqueueWork(()=>controller.act(action as CaptureAction));
 },
});
 process.stdin.resume();
}
if (handoffDirectory && handoff) {
  await acceptCaptureHandoff(handoffDirectory, handoff, draft);
}
startInput();
process.stdout.on("resize", draw);
process.on("SIGINT", () => stopAfterRetainingDraft(130));
process.on("SIGTERM", () => stopAfterRetainingDraft(143));
process.on("SIGHUP", () => stopAfterRetainingDraft(129));
draw();
if (handoffDirectory && handoff) await confirmCaptureHandoff(handoffDirectory, handoff);
if (handoff?.editor) enqueueWork(() => controller.editExternal());
