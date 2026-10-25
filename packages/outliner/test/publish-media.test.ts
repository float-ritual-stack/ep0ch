import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { Publisher } from "../src/publish";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { scratchOutline } from "./scratch-outline";
import type { ResourceProjectionReadResult } from "../src/resource-projection";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// The eight bytes every PNG starts with, and a little more: enough for a type check, not a real picture.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** A throwaway service over a fictional outline whose folder holds a moth photo, and a publisher reading it. */
async function setup(options: { extensions?: string[] } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-publish-media-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "garden");
  mkdirSync(join(workspace, "images"), { recursive: true });
  writeFileSync(join(workspace, "images", "luna-moth.png"), PNG);
  const elsewhere = join(root, "elsewhere");
  mkdirSync(elsewhere);
  writeFileSync(join(elsewhere, "private.png"), PNG);
  // The outliner's own example extensions, in the outline's folder, as an install puts them.
  for (const id of options.extensions ?? []) cpSync(join(import.meta.dir, "..", "extensions", id), join(workspace, "extensions", id), { recursive: true });
  const paths = scratchOutline(root, { folder: workspace });
  const store = new OutlinerStore(paths.database, { workspaceRoot: workspace });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  const client = new OutlinerClient(paths.socket);
  const publisher = new Publisher({ client });
  cleanups.push(async () => {
    await publisher.stop();
    await server.close();
    store.close();
  });
  await publisher.start();
  const get = (path: string, audience: "tailnet" | "public" = "tailnet") =>
    publisher.handle(new Request(`http://127.0.0.1${path}`, { headers: { accept: "text/html" } }), audience);
  return { workspace, elsewhere, store, client, publisher, get };
}

test("an image line on a published page is the image: served from the outline's folder, with its alt text, size and dim", async () => {
  const { store, get, workspace } = await setup();
  const note = store.create(`Moth night [publish::public:moth-night]\nWhat came to the sheet.\n- [img::${join(workspace, "images/luna-moth.png")}] [size::70%] [align::center] [dim::0.3] [alt::a luna moth on the sheet]`);
  const html = await (await get("/p/moth-night?view=html")).text();
  expect(html).toContain(`<img src="/p/${note.id}/media/2" alt="a luna moth on the sheet" loading="lazy"`);
  expect(html).toContain("width:70%");
  expect(html).toContain("filter:brightness(0.7)");
  expect(html).toContain('class="media media-center"');
  expect(html).not.toContain("[img::");

  const image = await get(`/p/${note.id}/media/2`);
  expect(image.status).toBe(200);
  expect(image.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
  // A relative path is the outline folder's, and a child note's image line (its first line) is drawn too.
  const child = store.create("[img::images/luna-moth.png] [alt::the same moth, closer]", note.id);
  const whole = await (await get("/p/moth-night?view=full")).text();
  expect(whole).toContain(`<img src="/p/${child.id}/media/0" alt="the same moth, closer"`);
  // In the note's folder, that child's row names its picture, not its path.
  const folder = await (await get("/p/moth-night?view=html")).text();
  expect(folder).toContain("image: the same moth, closer");
  expect(folder).not.toContain("images/luna-moth.png");
  // The public listener serves it too, under its own mount, since the note is public.
  expect((await get(`/share/p/${note.id}/media/2`, "public")).status).toBe(200);
  // The Markdown of the page is the image too.
  const markdown = await (await get("/p/moth-night?view=md")).text();
  expect(markdown).toContain(`![a luna moth on the sheet](/p/${note.id}/media/2)`);
});

test("an extension view's image primitive (PIE-827) is the page's image: served by its line and its place in the view, never by a path", async () => {
  const { store, client, get, elsewhere } = await setup({ extensions: ["gallery"] });
  const note = store.create("Moth cards [publish::public:moth-cards]\ngallery::");
  store.create("Luna [cover::images/luna-moth.png]\nOn the sheet at midnight.", note.id);
  store.create(`Stray [cover::${join(elsewhere, "private.png")}]`, note.id);
  const end = Date.now() + 10_000;
  for (;;) {
    const read = await client.request<ResourceProjectionReadResult>({ action: "resources.projection.read", blockId: note.id });
    const view = JSON.stringify(read.projections.find((p) => p.kind === "component")?.output?.component?.view ?? null);
    if (view.includes("luna-moth") && view.includes("private.png")) break;
    if (Date.now() > end) throw new Error(`the gallery never drew both cards: ${view}`);
    await Bun.sleep(50);
  }
  const html = await (await get("/p/moth-cards?view=html")).text();
  expect(html).toContain(`<img src="/p/${note.id}/media/1/0" alt="Luna" loading="lazy"`);
  expect(html).toContain("object-fit:cover");
  // A file outside the publish roots is its words and its file's name, never its path, never served.
  expect(html).toContain('<span class="media-what">image</span> Stray <code>private.png</code>');
  const component = html.slice(html.indexOf('<div class="ext-component">'), html.indexOf("Stray <code>private.png</code>"));
  expect(component).toContain("Luna");
  expect(component).not.toContain(elsewhere);
  const image = await get(`/p/${note.id}/media/1/0`);
  expect(image.status).toBe(200);
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
  expect((await get(`/p/${note.id}/media/1/1`)).status).toBe(404);
  expect((await get(`/p/${note.id}/media/1/9`)).status).toBe(404);
  // The note says nothing of the pictures: they are the view's.
  expect(store.get(note.id)?.text).toBe("Moth cards [publish::public:moth-cards]\ngallery::");
}, 30_000);

test("an image the page may not serve shows its alt text and its file's name, never its path or an empty bullet", async () => {
  const { store, get, elsewhere } = await setup();
  const note = store.create([
    "Sheet log [publish::sheet-log]",
    `- [img::${join(elsewhere, "private.png")}] [alt::a moth from elsewhere]`,
    "- [img::images/../images/luna-moth.png] [alt::a climbing path]",
    "- [img::images/missing-moth.png]",
    "```",
    "[img::images/luna-moth.png]",
    "```",
  ].join("\n"));
  const html = await (await get("/p/sheet-log?view=html")).text();
  expect(html).not.toContain("<img");
  expect(html).toContain("a moth from elsewhere <code>private.png</code>");
  expect(html).toContain("a climbing path <code>luna-moth.png</code>");
  expect(html).toContain("<code>missing-moth.png</code>");
  expect(html).not.toContain(elsewhere);
  // A media line in code is code.
  expect(html).toContain("[img::images/luna-moth.png]");
  // Asked for directly, none of them is served.
  for (const line of [1, 2, 3, 5]) expect((await get(`/p/${note.id}/media/${line}`)).status).toBe(404);
});

test("an image is served only where its note is shown: never under [publish::never], never publicly unless public", async () => {
  const { store, get } = await setup();
  const open = store.create("Open note [publish::open-note]\n[img::images/luna-moth.png]");
  const locked = store.create("Locked [publish::never]\n[img::images/luna-moth.png]");
  const under = store.create("[img::images/luna-moth.png]", locked.id);
  const left = store.create("Public walk [publish::public:walk]");
  const hidden = store.create("Kept off [publish::false]\n[img::images/luna-moth.png]", left.id);

  expect((await get(`/p/${open.id}/media/1`)).status).toBe(200);
  expect((await get(`/p/${locked.id}/media/1`)).status).toBe(404);
  expect((await get(`/p/${under.id}/media/0`)).status).toBe(404);
  // On the public listener: a tailnet-only note's image isn't there, nor one its public page leaves out.
  expect((await get(`/share/p/${open.id}/media/1`, "public")).status).toBe(404);
  expect((await get(`/share/p/${hidden.id}/media/1`, "public")).status).toBe(404);
  // A line that isn't an image line serves nothing.
  expect((await get(`/p/${open.id}/media/0`)).status).toBe(404);
});

test("rendered in the service (no listener), an image is its alt text and its file's name", async () => {
  const { store, client } = await setup();
  const note = store.create("Field card\n[img::images/luna-moth.png] [alt::a luna moth]");
  const service = Publisher.inService(client);
  const rendered = await service.renderNote(note.id, "markdown");
  expect(rendered.text).toContain("*image: a luna moth* `luna-moth.png`");
});

test("imported artifact paths frame their static URLs and keep files outside the outline", async () => {
  const { store, client, get, workspace, elsewhere } = await setup();
  const old = process.env.EP0CH_ARTIFACT_ORIGIN;
  process.env.EP0CH_ARTIFACT_ORIGIN = "https://artifacts.example.test";
  cleanups.push(() => { if (old === undefined) delete process.env.EP0CH_ARTIFACT_ORIGIN; else process.env.EP0CH_ARTIFACT_ORIGIN = old; });
  mkdirSync(join(workspace, "artifacts"));
  writeFileSync(join(workspace, "artifacts", "orbit-lamp.html"), "<!doctype html><title>Orbit lamp</title><canvas></canvas>");
  await client.request({ action: "artifacts.import" });
  const note = store.create(`Desk toys [publish::public:desk-toys]\n[artifact::artifacts/orbit-lamp.html] [height::20] [alt::Orbit lamp]\n[artifact::${join(elsewhere, "secret.html")}]`);
  const html = await (await get("/p/desk-toys?view=html")).text();
  // The owner's page frames it from the artifact host (a grant for that artifact); "open" is this site's own route.
  expect(html).toMatch(/<iframe src="https:\/\/artifacts\.example\.test\/k\/\d+\.[\w-]+\/orbit-lamp%401\/" title="Orbit lamp"/);
  expect(html).toContain("height:25.00rem");
  expect(html).not.toContain(elsewhere);
  expect(html).toContain(`href="/p/${note.id}/artifact/1"`);
  const frame = await get(`/p/${note.id}/artifact/1`);
  expect(frame.status).toBe(200);
  expect(await frame.text()).toMatch(/<iframe src="https:\/\/artifacts\.example\.test\/k\//);
  expect((await get(`/p/${note.id}/artifact/2`)).status).toBe(404);
  // A public reader gets nothing of what the store holds, even by the file it was imported from.
  expect((await get(`/share/p/${note.id}/artifact/1`, "public")).status).toBe(404);
  expect(await (await get("/p/desk-toys?view=md")).text()).toContain(`([open](/p/${note.id}/artifact/1))`);
});

test("an artifact runs only where its note is shown: never under [publish::never], never publicly unless public", async () => {
  const { store, client, get } = await setup();
  const old = process.env.EP0CH_ARTIFACT_ORIGIN;
  process.env.EP0CH_ARTIFACT_ORIGIN = "https://artifacts.example.test";
  cleanups.push(() => { if (old === undefined) delete process.env.EP0CH_ARTIFACT_ORIGIN; else process.env.EP0CH_ARTIFACT_ORIGIN = old; });
  await client.request({ action: "artifacts.put", name: "lamp", files: { "index.html": "<title>Lamp</title>" } });
  const open = store.create("Open toys [publish::open-toys]\n[artifact::lamp]");
  const locked = store.create("Locked toys [publish::never]\n[artifact::lamp]");
  expect((await get(`/p/${open.id}/artifact/1`)).status).toBe(200);
  expect((await get(`/p/${locked.id}/artifact/1`)).status).toBe(404);
  expect((await get(`/share/p/${open.id}/artifact/1`, "public")).status).toBe(404);
  expect((await get(`/p/${open.id}/media/1`)).status).toBe(404);
});
