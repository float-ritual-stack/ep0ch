import {expect, test} from "bun:test";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {OutlinerServer} from "../src/server";
import {OutlinerClient} from "../src/client";
import type {Block, CaptureOwnerClaim, QuickCaptureDraft, QuickCaptureDraftSaveInput} from "../src/types";
import type {EditRecovery} from "../src/edit-recovery";
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

test("a prepared capture note in Trash or purged does not prevent discarding the draft", () => {
  const directory = mkdtempSync(join(tmpdir(), "outliner-trashed-capture-"));
  const store = new OutlinerStore(join(directory, "outline.sqlite"));
  try {
    const trashed = store.saveQuickCaptureDraft({requestId:"trashed",text:"Trashed draft",
      cursorRow:0,cursorColumn:0,expectedRevision:null,prepareBlock:true});
    store.delete(trashed.blockId!);
    expect(store.clearQuickCaptureDraft(trashed.revision)).toBeNull();
    expect(store.quickCaptureDraft()).toBeNull();
    expect(store.require(trashed.blockId!).deletedAt).toBeString();

    const purged = store.saveQuickCaptureDraft({requestId:"purged",text:"Purged draft",
      cursorRow:0,cursorColumn:0,expectedRevision:null,prepareBlock:true});
    store.delete(purged.blockId!);
    store.purge(purged.blockId!, purged.blockId!.slice(0, 8));
    expect(store.clearQuickCaptureDraft(purged.revision)).toBeNull();
    expect(store.quickCaptureDraft()).toBeNull();
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});

test("capture recovery RPC preserves concurrent writing and atomically reconciles the same protected note", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-capture-recovery-"));
  const store = new OutlinerStore(join(root, "outline.sqlite"), {workspaceRoot: root});
  const server = new OutlinerServer(store, join(root, "rpc.sock"));
  await server.start();
  const client = new OutlinerClient(join(root, "rpc.sock"));
  const readBlock = (blockId: string) => client.request<Block>({action: "get", blockId});
  const readDraft = () => client.request<QuickCaptureDraft | null>({action: "capture.draft.get"});
  try {
    const draft = await client.request<QuickCaptureDraft>({action: "capture.draft.save", input: {
      requestId: "recover-capture", text: "", cursorRow: 0, cursorColumn: 0, expectedRevision: null, prepareBlock: true,
    }});
    expect((await readDraft())?.blockId).toBe(draft.blockId);
    const base = await readBlock(draft.blockId!);
    const first = await client.request<Block>({action: "update", blockId: base.id,
      text: "Writing from another surface", expectedRevision: base.revision, mutation: {author: "user"}});
    await expect(client.request({action: "capture.create", requestId: draft.requestId, text: "Stale buffer",
      source: "tree", expectedDraftRevision: draft.revision})).rejects.toThrow(/changed/);
    await expect(client.request({action: "capture.draft.clear", expectedRevision: draft.revision})).rejects.toThrow(/changed/);
    let record = await client.request<EditRecovery>({action: "edit-recovery.start", input: {
      id: crypto.randomUUID(), blockId: base.id, baseText: base.text, baseRevision: base.revision,
      prelaunchText: base.text, draftText: "Returned editor writing", source: "external-editor",
    }});
    const newer = await client.request<Block>({action: "update", blockId: base.id,
      text: "Changed again after review", expectedRevision: first.revision, mutation: {author: "user"}});
    const reviewedInput = (): QuickCaptureDraftSaveInput => ({...draft, text: "Reviewed combination",
      cursorRow: 0, cursorColumn: 0, expectedRevision: draft.revision,
      recovery: {id: record.id, revision: record.revision, basedOnBlockRevision: record.latest.revision}});
    await expect(client.request({action: "capture.draft.save", input: reviewedInput()})).rejects.toThrow(/changed/);
    expect(await readBlock(base.id)).toEqual(newer);
    record = await client.request<EditRecovery>({action: "edit-recovery.refresh", recoveryId: record.id, expectedRevision: record.revision});
    // This guard runs after the recovery commit. Neither that commit nor its
    // applied-history receipt may survive a rejected capture update.
    await expect(client.request({action: "capture.draft.save", input: {...reviewedInput(), cursorRow: -1}})).rejects.toThrow(/cursor/);
    expect(await readBlock(base.id)).toEqual(newer);
    expect(await readDraft()).toEqual(draft);
    expect(await client.request<EditRecovery>({action: "edit-recovery.get", recoveryId: record.id})).toEqual(record);
    const reconciled = await client.request<QuickCaptureDraft>({action: "capture.draft.save", input: reviewedInput()});
    expect(reconciled.blockId).toBe(base.id);
    expect(reconciled.blockRevision).toBe((await readBlock(base.id)).revision);
    expect((await readBlock(base.id)).text).toBe("Reviewed combination");
    expect(store.isCaptureDraft(base.id)).toBe(true);
    const applied = await client.request<EditRecovery>({action: "edit-recovery.get", recoveryId: record.id});
    expect(applied.state).toBe("applied");
    expect(applied.latest.text).toBe(newer.text);
    const saved = await client.request<{block: Block}>({action: "capture.create", requestId: draft.requestId,
      text: reconciled.text, source: "tree", expectedDraftRevision: reconciled.revision});
    expect(saved.block.id).toBe(base.id);
    await client.request({action: "capture.draft.clear", expectedRevision: reconciled.revision});
    expect(await readDraft()).toBeNull();
    expect(store.children(saved.block.parentId!)).toHaveLength(1);
  } finally {await server.close(); store.close(); rmSync(root, {recursive: true, force: true});}
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


test("one live Capture owner transfers explicitly and releases on disconnect without losing its draft", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-capture-owner-"));
  const store = new OutlinerStore(join(root, "outline.sqlite"), {workspaceRoot: root});
  const server = new OutlinerServer(store, join(root, "rpc.sock"));
  await server.start();
  const client = new OutlinerClient(join(root, "rpc.sock"));
  const watchers: ReturnType<OutlinerClient["watch"]>[] = [];
  const location = {hostname: "fixture-host", herdrSocket: join(root, "herdr.sock"), paneId: "w1:p1", popup: true};
  const register = async (clientId: string) => {
    const ready = Promise.withResolvers<void>();
    const watcher = client.watch({client: {clientId, contextId: "capture", role: "observer"},
      onConnect: ready.resolve, onEvent() {}, onError: ready.reject});
    watchers.push(watcher); await ready.promise; return watcher;
  };
  const claim = (clientId: string, transferToken?: string) => client.request<CaptureOwnerClaim>({
    action: "capture.owner.claim", clientId, location, transferToken});
  try {
    const first = await register("first");
    const second = await register("second");
    expect((await claim("first")).acquired).toBe(true);
    let draft = await client.request<QuickCaptureDraft>({action: "capture.draft.save", input: {
      requestId: "owned-draft", text: "Unsaved work belongs here", cursorRow: 0, cursorColumn: 3,
      expectedRevision: null, prepareBlock: true, ownerClientId: "first"}});
    expect(await claim("second")).toMatchObject({acquired: false, owner: {clientId: "first"}});
    await expect(client.request({action: "capture.draft.save", input: {...draft, text: "Competing editor",
      expectedRevision: draft.revision, ownerClientId: "second"}})).rejects.toThrow(/owner/);
    await expect(client.request({action: "capture.draft.save", input: {...draft, expectedRevision: draft.revision}})).rejects.toThrow(/owner/);
    await expect(client.request({action: "capture.owner.handoff", clientId: "second", requestId: draft.requestId,
      expectedDraftRevision: draft.revision})).rejects.toThrow(/owner/);
    const transfer = await client.request<{token: string}>({action: "capture.owner.handoff", clientId: "first",
      requestId: draft.requestId, expectedDraftRevision: draft.revision});
    await expect(claim("second", "invalid-token")).rejects.toThrow(/handoff/);
    expect((await claim("second", transfer.token)).acquired).toBe(true);
    await expect(client.request({action: "capture.draft.clear", expectedRevision: draft.revision, ownerClientId: "first"})).rejects.toThrow(/owner/);
    await expect(client.request({action: "capture.create", requestId: draft.requestId, text: draft.text,
      source: "tree", expectedDraftRevision: draft.revision, ownerClientId: "first"})).rejects.toThrow(/owner/);
    draft = await client.request<QuickCaptureDraft>({action: "capture.draft.save", input: {...draft, text: "Continued in new surface",
      expectedRevision: draft.revision, ownerClientId: "second"}});
    await expect(claim("first", transfer.token)).rejects.toThrow(/handoff/);
    expect((await claim("first")).acquired).toBe(false);
    await first.stop();
    expect(await client.request({action: "capture.owner.get"})).toMatchObject({clientId: "second"});
    await second.stop();
    await register("first");
    // Process/socket closure, rather than a timeout or stale file, releases ownership.
    await client.request({action: "clients.list"});
    expect((await claim("first")).acquired).toBe(true);
    expect(await client.request<QuickCaptureDraft>({action: "capture.draft.get"})).toEqual(draft);
    expect(store.require(draft.blockId!).text).toBe("Continued in new surface");
  } finally {await Promise.all(watchers.map(w => w.stop())); await server.close(); store.close(); rmSync(root, {recursive: true, force: true});}
});
