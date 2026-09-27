import {expect, test} from "bun:test";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {OutlinerStore} from "../src/store";
import {InboxRepository} from "../src/inbox-repository";
import {NoteAssistanceRepository} from "../src/note-assistance-repository";

test("prepared capture retains one protected note through restart, edits and retried submission", () => {
  const directory = mkdtempSync(join(tmpdir(), "outliner-docked-capture-"));
  const path = join(directory, "outline.sqlite");
  let store = new OutlinerStore(path);
  try {
    let draft = store.saveQuickCaptureDraft({requestId:"docked",text:"  A draft\n- keep this\n",
      cursorRow:1,cursorColumn:4,selectionAnchor:{row:0,column:2},expectedRevision:null,prepareBlock:true});
    expect(draft.blockId).toBeString();
    const blockId = draft.blockId!;
    expect(store.require(blockId).text).toBe("  A draft\n- keep this\n");
    expect(new InboxRepository(store).pending().map(b=>b.id)).not.toContain(blockId);
    let notes = new NoteAssistanceRepository(store); notes.initialize();
    expect(notes.candidateFor(blockId)).toBeUndefined();
    store.close(); store = new OutlinerStore(path);
    expect(store.quickCaptureDraft()).toEqual(draft);
    const changed = "  A draft\n- keep this\n  - another step\n";
    draft = store.saveQuickCaptureDraft({...draft,text:changed,cursorRow:2,cursorColumn:4,expectedRevision:draft.revision,prepareBlock:true});
    expect(draft.blockId).toBe(blockId);
    expect(store.require(blockId).text).toBe(changed);
    expect(new InboxRepository(store).pending().map(b=>b.id)).not.toContain(blockId);
    notes = new NoteAssistanceRepository(store);
    expect(notes.pending().map(c=>c.source.id)).not.toContain(blockId);
    expect(()=>store.capture("docked",changed,"cli",undefined,"user",undefined,draft.revision)).toThrow(/provenance/);
    const receipt = store.capture("docked", changed, "tree", undefined, "user", undefined, draft.revision);
    expect(receipt.block.id).toBe(blockId);
    expect(receipt.block.text).toContain("  - another step\n");
    // A committed submission can lose its acknowledgement before draft cleanup.
    store.close(); store = new OutlinerStore(path);
    const resumed = store.quickCaptureDraft()!;
    const recovered = store.capture("docked", changed, "tree", undefined, "user", undefined,
      resumed.blockId ? resumed.revision : undefined);
    expect(recovered).toMatchObject({deduplicated:true,block:{id:blockId}});
    store.clearQuickCaptureDraft(draft.revision);
    const replay = store.capture("docked", changed, "tree", undefined, "user", undefined, draft.revision);
    expect(replay).toMatchObject({deduplicated:true,block:{id:blockId}});
    expect(store.children(receipt.inboxBlockId)).toHaveLength(1);
    expect(new InboxRepository(store).pending().map(b=>b.id)).toContain(blockId);
    expect(store.quickCaptureDraft()).toBeNull();
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});

test("blank preparation is recoverable, while concurrent canonical writing defeats submit and discard", () => {
  const directory = mkdtempSync(join(tmpdir(), "outliner-docked-conflict-"));
  const store = new OutlinerStore(join(directory,"outline.sqlite"));
  try {
    const draft = store.saveQuickCaptureDraft({requestId:"empty",text:"",cursorRow:0,cursorColumn:0,expectedRevision:null,prepareBlock:true});
    expect(store.quickCaptureDraft()?.blockId).toBe(draft.blockId);
    const block = store.require(draft.blockId!);
    store.update(block.id,"Writing from another surface",block.revision,{author:"user"});
    expect(()=>store.capture("empty","Stale buffer","tree",undefined,"user",undefined,draft.revision)).toThrow(/changed/);
    expect(()=>store.clearQuickCaptureDraft(draft.revision)).toThrow(/changed/);
    expect(store.require(block.id).text).toBe("Writing from another surface");
    expect(store.require(block.id).deletedAt).toBeUndefined();
    expect(store.quickCaptureDraft()?.blockId).toBe(block.id);
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});

test("capture editor retains selection and exact writing through an uncertain save and reopen", async () => {
  const {CapturePopupController} = await import("../src/capture-popup");
  const directory = mkdtempSync(join(tmpdir(), "outliner-capture-editor-"));
  const path = join(directory, "outline.sqlite");
  let store = new OutlinerStore(path);
  let loseReply = true;
  let editorDraft: import("../src/types").QuickCaptureDraft | undefined;
  const original = "  Draft\n- first\n  - nested\n";
  const edited = "  Draft\n- first\n  - nested\n  - continued\n";
  const effects: import("../src/capture-popup").CapturePopupEffects = {
    async save(input) {
      store.capture(input.requestId, input.text, "tree", input.capturedFromBlockId, "user", undefined, input.expectedDraftRevision);
      if (loseReply) { loseReply = false; throw Error("reply lost"); }
    },
    async persistDraft(input) { return store.saveQuickCaptureDraft(input); },
    async clearDraft(revision) { store.clearQuickCaptureDraft(revision); },
    async editExternal(draft) {
      editorDraft = draft;
      expect(store.require(draft.blockId!).text).toBe(original);
      return {text: edited, cleanup() {}, async retain() {}};
    },
    close() {}, invalidate() {},
  };
  try {
    const first = new CapturePopupController(effects, {requestId: "editor-capture"});
    first.handlePaste(original);
    first.buffer.placeCursor(1, 2);
    first.buffer.placeCursor(1, 7, true);
    await first.handleKeypress("", {name: "e", ctrl: true}, "pass");
    expect(editorDraft?.selectionAnchor).toEqual({row: 1, column: 2});
    expect(editorDraft?.cursorColumn).toBe(7);
    const blockId = store.quickCaptureDraft()!.blockId!;
    expect(store.require(blockId).text).toBe(edited);
    expect(store.isCaptureDraft(blockId)).toBe(true);
    first.buffer.placeCursor(2, 4);
    first.buffer.placeCursor(2, 10, true);
    await first.closeRetainingDraft();
    store.close(); store = new OutlinerStore(path);
    const reopened = new CapturePopupController(effects, {requestId: "ignored", draft: store.quickCaptureDraft()!});
    expect(reopened.buffer.selectedText).toBe("nested");
    expect(reopened.buffer.text).toBe(edited);
    await reopened.handleKeypress("", {name: "s", ctrl: true}, "pass");
    expect(reopened.status).toContain("reply lost");
    await reopened.closeRetainingDraft();
    store.close(); store = new OutlinerStore(path);
    const retried = new CapturePopupController(effects, {requestId: "ignored-again", draft: store.quickCaptureDraft()!});
    await retried.handleKeypress("", {name: "s", ctrl: true}, "pass");
    expect(store.quickCaptureDraft()).toBeNull();
    const saved = store.require(blockId);
    expect(saved.text).toStartWith("  Draft [type::capture]");
    expect(saved.text).toEndWith("\n- first\n  - nested\n  - continued\n");
    expect(store.children(saved.parentId!)).toHaveLength(1);
    expect(store.isCaptureDraft(blockId)).toBe(false);
  } finally {store.close(); rmSync(directory, {recursive: true, force: true});}
});
