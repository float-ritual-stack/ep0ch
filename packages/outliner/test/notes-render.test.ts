// A note's address and its rendering (PIE-767): `notes.address` says the outline, this machine's name, the note's
// ep0ch:// URI and, when a publisher serves it, its web URLs; `notes.render` renders a note through the publisher's own
// renderer, published or not, and refuses a [publish::never] one. A scratch service in a temp folder; every note is
// made up, and the publisher's URLs are .invalid names.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { canonicalLocalMachineName } from "../src/machine-name";
import { Publisher, publisherUrl } from "../src/publish";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, NoteAddress, RenderedNote } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-notes-render-")));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: root });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state") });
  server.setOutline({ name: "garden" });
  await server.start();
  const client = new OutlinerClient(socket, 20_000);
  cleanups.push(async () => {
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const create = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
  const publisher = async () => {
    const started = new Publisher({ client, url: "https://pub.example.invalid/pub/", publicUrl: "https://share.example.invalid/share" });
    await started.start();
    cleanups.push(() => started.stop());
  };
  return { client, create, publisher };
}

test("notes.address: the outline and this machine, a note's ep0ch:// URI, and its web URLs once a publisher says where it is opened", async () => {
  const { client, create, publisher } = await setup();
  const machine = canonicalLocalMachineName();
  expect(await client.request<NoteAddress>({ action: "notes.address" })).toEqual({ outline: "garden", machine });
  const shed = await create("Shed notes [publish::shed]\n\nThe door sticks in the rain.");
  const pond = await create("Pond notes [publish::public:pond]\n\nThe heron came back.");
  const draft = await create("Draft\n\nNot published.");
  expect(await client.request<NoteAddress>({ action: "notes.address", blockId: draft.id })).toEqual({
    outline: "garden", machine, blockId: draft.id, uri: `ep0ch://garden@${machine}/b/${draft.id}`,
  });
  // Published, with no publisher connected: its slug, but no host to give a URL on.
  expect((await client.request<NoteAddress>({ action: "notes.address", blockId: shed.id })).published).toEqual({ slug: "shed", public: false });
  await publisher();
  expect((await client.request<NoteAddress>({ action: "notes.address", blockId: shed.id })).published).toEqual({
    slug: "shed", public: false, url: "https://pub.example.invalid/pub/p/shed", permalink: `https://pub.example.invalid/pub/p/${shed.id}`,
  });
  expect((await client.request<NoteAddress>({ action: "notes.address", blockId: pond.id })).published).toEqual({
    slug: "pond", public: true, url: "https://pub.example.invalid/pub/p/pond", publicUrl: "https://share.example.invalid/share/p/pond",
    permalink: `https://share.example.invalid/share/p/${pond.id}`,
  });
  await expect(client.request({ action: "notes.address", blockId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow();
});

test("notes.render: the publisher's rendering of a note and the notes under it, published or not; a [publish::never] note is refused", async () => {
  const { client, create, publisher } = await setup();
  const shed = await create("Shed notes [publish::shed]\n\nThe door sticks in the rain.");
  const note = await create(`Pond notes [type::journal]\n\nThe heron came back, see ((${shed.id})) and [[Nowhere]].`);
  await create("Later: the heron left at dusk.", note.id);
  // No publisher connected: a link is its label, never a path on no host.
  const plain = await client.request<RenderedNote>({ action: "notes.render", blockId: note.id, format: "markdown" });
  expect(plain).toEqual({ blockId: note.id, title: "Pond notes", format: "markdown", published: false,
    text: "# Pond notes\n\nThe heron came back, see Shed notes and Nowhere.\n\n- Later: the heron left at dusk.\n" });
  await publisher();
  const linked = await client.request<RenderedNote>({ action: "notes.render", blockId: note.id, format: "markdown" });
  expect(linked.text).toContain("see [Shed notes](https://pub.example.invalid/pub/p/shed) and Nowhere.");
  const html = await client.request<RenderedNote>({ action: "notes.render", blockId: note.id, format: "html" });
  expect(html.text).toContain("<h1>Pond notes</h1>");
  expect(html.text).toContain('<a href="https://pub.example.invalid/pub/p/shed?view=html">Shed notes</a>');
  expect(html.text).toContain("<li>Later: the heron left at dusk.</li>");
  expect(html.text).not.toContain("<html");
  // Public: only public notes are linked.
  expect((await client.request<RenderedNote>({ action: "notes.render", blockId: note.id, format: "markdown", audience: "public" })).text).toContain("see unpublished note and");
  // Locked, itself or by a note above it.
  const locked = await create("Private [publish::never]\n\nNot for anywhere else.");
  const under = await create("Under it", locked.id);
  for (const blockId of [locked.id, under.id]) {
    await expect(client.request({ action: "notes.render", blockId, format: "html" })).rejects.toThrow("[publish::never]");
  }
  await expect(client.request({ action: "notes.render", blockId: note.id, format: "pdf" as never })).rejects.toThrow("markdown or html");
});

test("a publisher's URL is a full http(s) URL a note's path can follow: no query, fragment or credentials", () => {
  expect(publisherUrl("https://pub.example.invalid/pub/")).toBe("https://pub.example.invalid/pub");
  for (const bad of ["https://pub.example.invalid/pub#top", "https://pub.example.invalid/pub?x=1", "ftp://pub.example.invalid", "http://[", "https://someone:secret@pub.example.invalid"]) {
    expect(() => publisherUrl(bad)).toThrow("--url must be the full http(s) URL");
  }
});
