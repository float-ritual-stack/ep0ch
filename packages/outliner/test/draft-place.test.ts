// draft.place (native W5): a patch placed by the service for a holder that places none itself. The holder (a window
// that reads no Blockdown) answers a `patch` with its draft as it stands; the service decides with the door's own rule
// (outline-core's placeDraftPatch) and sends back the spans to replace. Fictional notes only.
import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { scratchDir } from "./scratch-outline";
import { OutlinerClient } from "../src/client";
import type { DraftHolderRequest, DraftPatchResult, HeldDraft } from "../src/draft-patch";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { OutlinerEvent } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function service() {
  const directory = scratchDir("draft-place-");   // a socket lives here: never tmpdir() (PIE-1654)
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const socket = join(directory, "outliner.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); });
  return { store, client: new OutlinerClient(socket, 10_000) };
}

const TIDY = { author: "agent" as const, actorId: "tidy" };

/**
 * A stand-in for the native window: it holds a draft, knows where its cursor is, and places nothing. A `patch` or a
 * `revert` is answered with the draft as it stands; a `place` is taken only while the text is the version it names.
 * `typesOnce`: text typed between the draft being said and the first `place` arriving.
 */
async function thinHolder(client: OutlinerClient, clientId: string, blockId: string, text: string, revision: number, cursor: number, options: { typesOnce?: (text: string) => string } = {}) {
  const held = { text, revision, cursor, asks: [] as DraftHolderRequest[], said: [] as string[] };
  let typed = options.typesOnce;
  const version = () => `v${Bun.hash(held.text)}`;
  const stands = (): HeldDraft => ({ text: held.text, revision: held.revision, version: version(), cursor: held.cursor, anchor: held.cursor });
  const connected = Promise.withResolvers<void>();
  const watcher = client.watch({
    client: { clientId, role: "observer", contextId: clientId },
    onConnect: connected.resolve,
    onEvent: async (event: OutlinerEvent) => {
      if (event.domain !== "draft" || !event.draft) return;
      const ask = event.draft;
      held.asks.push(ask);
      let answer: unknown;
      if (ask.kind === "read") answer = { text: held.text, revision: held.revision };
      else if (ask.kind === "patch") { answer = { applied: false, reason: "this window places no patch: the service does", draft: stands() }; if (typed) { held.text = typed(held.text); typed = undefined; } }
      else if (ask.kind === "revert") answer = { reverted: false, draft: stands() };
      else if (ask.version !== version()) answer = { applied: false, reason: "the draft was typed in since it was read", draft: stands() };
      else {
        let out = "", at = 0;
        for (const span of ask.spans) { out += held.text.slice(at, span.start) + span.replacement; at = span.end; }
        held.text = out + held.text.slice(at);
        if (ask.standsOn) held.revision = ask.standsOn.revision;
        if (ask.did) held.said.push(`${ask.mutation?.actorId}: ${ask.did}`);
        answer = { applied: true };
      }
      await client.request({ action: "drafts.answer", requestId: ask.requestId, clientId, answer: answer as never }).catch(() => undefined);
    },
  });
  cleanups.push(() => watcher.stop());
  await connected.promise;
  await client.request({ action: "drafts.hold", blockId, clientId, revision });
  return held;
}

const DRAFT = "Seed list\n\nThe beans  go  along the fence.\n\nSow the peas by the sh";

test("a patch for a holder that places none is placed by the service: in the draft, attributed, and the saved note is left alone", async () => {
  const { store, client } = await service();
  const note = store.create("Seed list\n\nThe beans  go  along the fence.");
  const window = await thinHolder(client, "native-1", note.id, DRAFT, note.revision, DRAFT.length);
  const result = await client.request<DraftPatchResult>({ action: "draft.patch", blockId: note.id, revision: note.revision,
    patches: [{ observed: "The beans  go  along the fence.", replacement: "The beans go along the fence." }], mutation: TIDY });
  expect(result).toMatchObject({ outcome: "applied", edits: [{ blockId: note.id, route: "draft", holder: "native-1" }] });
  expect(window.text).toBe("Seed list\n\nThe beans go along the fence.\n\nSow the peas by the sh");
  expect(window.said).toEqual(["tidy: edited text above your cursor"]);
  // The holder was asked to patch, said what it holds, and was handed the spans: it found nothing itself.
  const place = window.asks.find(ask => ask.kind === "place");
  expect(place).toMatchObject({ kind: "place", spans: [{ start: 11, end: 42, replacement: "The beans go along the fence." }], mutation: TIDY });
  expect(store.require(note.id)).toMatchObject({ text: "Seed list\n\nThe beans  go  along the fence.", revision: note.revision });
});

test("a patch that touches the paragraph at the cursor is refused with why, by the door's own rule, and nothing changes", async () => {
  const { store, client } = await service();
  const note = store.create("Seed list");
  const window = await thinHolder(client, "native-1", note.id, DRAFT, note.revision, DRAFT.length);
  await expect(client.request({ action: "draft.patch", blockId: note.id, revision: note.revision,
    patches: [{ observed: "Sow the peas", replacement: "Sow the sweet peas" }], mutation: TIDY })).rejects.toThrow("it changes the block being typed in");
  expect(window.text).toBe(DRAFT);
  expect(window.asks.some(ask => ask.kind === "place")).toBe(false);
});

test("a draft typed in while the patch was on its way is said again, and the patch is placed in what is there now", async () => {
  const { store, client } = await service();
  const note = store.create("Seed list");
  const window = await thinHolder(client, "native-1", note.id, DRAFT, note.revision, DRAFT.length, { typesOnce: text => `${text}ed` });
  const result = await client.request<DraftPatchResult>({ action: "draft.patch", blockId: note.id, revision: note.revision,
    patches: [{ observed: "Seed list", replacement: "Seed list, spring" }], mutation: TIDY });
  expect(result.outcome).toBe("applied");
  expect(window.text).toBe("Seed list, spring\n\nThe beans  go  along the fence.\n\nSow the peas by the shed");
  expect(window.asks.filter(ask => ask.kind === "place")).toHaveLength(2);
});

test("a patch over two notes that fails in the second is taken back out of the draft it was placed in", async () => {
  const { store, client } = await service();
  const held = store.create("Seed list");
  const other = store.create("Compost");
  const window = await thinHolder(client, "native-1", held.id, DRAFT, held.revision, DRAFT.length);
  await expect(client.request({ action: "draft.patch", mutation: TIDY, edits: [
    { blockId: held.id, revision: held.revision, patches: [{ observed: "Seed list", replacement: "Seed list, spring" }] },
    { blockId: other.id, revision: other.revision, patches: [{ observed: "Leaf mould", replacement: "Leaf mold" }] },
  ] })).rejects.toThrow();
  expect(window.text).toBe(DRAFT);
});

test("completion.rows asked with the text and the cursor finds the token and answers its rows merged, ready to write", async () => {
  const { store, client } = await service();
  store.create("Seed list [page::seed-list]");
  store.create("Shed [page::shed]");
  const text = "Sow the peas.\nSee [[see";
  const answer = await client.request<{ token: { kind: string; start: number; end: number; query: string } | null; rows: { label: string; insert: string; pick: string }[]; pickKey: string; heading: string }>({ action: "completion.rows", text, cursor: text.length });
  expect(answer.token).toEqual({ kind: "page", start: 18, end: text.length, query: "see" });
  expect(answer.rows[0]).toMatchObject({ insert: "[[seed-list]]" });
  expect(answer.rows.every(row => row.label && row.pick)).toBe(true);
  expect(answer.pickKey).toBe("[[");
  // No token at the cursor: nothing to list, said as no token.
  expect(await client.request<{ token: null; rows: unknown[] }>({ action: "completion.rows", text: "Sow the peas.", cursor: 5 })).toMatchObject({ token: null, rows: [] });
  await expect(client.request({ action: "completion.rows", text: "Sow", cursor: 9 })).rejects.toThrow("cursor");
});

// Whether Return is the field's or the list's is outline-core's one rule (`enterKeeps`); a window that reads no
// Blockdown is told its answer on the row: one that would leave the line as typed says Return types a line.
test("completion.rows for a text and a cursor says, on the row, when Return is the field's: a row that would leave the line as typed", async () => {
  const { store, client } = await service();
  store.create("Seed list [page::seed-list]");
  const text = "See [[seed-list]]";
  const done = await client.request<{ token: { start: number; end: number } | null; rows: { insert: string; enter?: string }[] }>({ action: "completion.rows", text, cursor: text.length - 2 });
  expect(done.token).toMatchObject({ start: 4, end: text.length });
  expect(done.rows[0]).toMatchObject({ insert: "[[seed-list]]", enter: "new line" });
  // A row that would write something says nothing: Return takes it.
  const begun = await client.request<{ rows: { insert: string; enter?: string }[] }>({ action: "completion.rows", text: "See [[see", cursor: 9 });
  expect(begun.rows[0]).toMatchObject({ insert: "[[seed-list]]" });
  expect(begun.rows[0]!.enter).toBeUndefined();
});

test("a row left out of the text-and-cursor form takes what its source said of it: nothing is offered that can't be chosen", async () => {
  const { store, client } = await service();
  store.create("Shed [page::shed]");
  // A page nobody wrote yet: the door offers to make it (`↓ then ⏎ makes it`), which needs a client that runs that
  // write first. A thin client is told there is no such page, and never how to choose a row it wasn't sent.
  const text = "See [[compost-heap";
  const answer = await client.request<{ token: { kind: string; query: string } | null; rows: unknown[]; message?: string }>({ action: "completion.rows", text, cursor: text.length });
  expect(answer.token).toMatchObject({ kind: "page", query: "compost-heap" });
  expect(answer.rows).toEqual([]);
  expect(answer.message).toContain("no matching named addresses");
  expect(answer.message).not.toContain("makes it");
  expect(answer.message).not.toContain("partial search");
});
