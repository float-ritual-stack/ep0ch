// PIE-1639: on the web reader (my.ep0ch.sh), a long press or a right-click on a row or a passage opens what it can do: the
// page's own choices for its words (Mark, Comment, Copy, …, as the threads route describes them), then Open and Copy
// link for the row. Mark lands as the person's mark on that row, through `/_marginalia/write action=mark`; a share link's
// menu has no Mark. The foot's "Mark this note" sits beside "Comment on this note". The shipped reader script runs in a
// happy-dom window at phone width, its requests answered by a scratch publisher; the outline is made up.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { OutlinerClient } from "../src/client";
import { Marks } from "../src/marks";
import { Publisher } from "../src/publish";
import { READER_SCRIPT } from "../src/publish-page";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import type { ShareSession } from "@ep0ch/outline-core/protocol";
import { scratchOutline } from "./scratch-outline";

const HOST = "garden.tail0000.ts.net";
let root = "";
let store: OutlinerStore;
let server: OutlinerServer;
let client: OutlinerClient;
let publisher: Publisher;
let plan: Block, row: Block;
const windows: Window[] = [];

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-web-mark-")));
  const paths = scratchOutline(root, { name: "garden" });
  store = new OutlinerStore(paths.database, { workspaceRoot: root });
  server = new OutlinerServer(store, paths.socket);
  await server.start();
  client = new OutlinerClient(paths.socket, 15_000);
  plan = store.create("Potato plan\nWhat goes in the ground in spring.", null, "user");
  row = store.create("Chit them on the windowsill, eyes up.", plan.id, "user");
  publisher = new Publisher({ client, basePath: "/pub", publicUrl: `https://${HOST}/share` });
  await publisher.start();
});

afterAll(async () => {
  for (const window of windows) await window.happyDOM.close();
  await publisher?.stop();
  await server?.close();
  store?.close();
  rmSync(root, { recursive: true, force: true });
});

const until = async (what: string, check: () => unknown, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
};

/** The page at `path` in a 390 px window, its reader script running, its requests answered by the publisher as `audience`. */
async function open(path: string, audience: "tailnet" | "public") {
  const response = await publisher.handle(new Request(`http://${HOST}${path}`, { headers: { host: HOST, accept: "text/html" } }), audience);
  expect(response.status).toBe(200);
  const window = new Window({ url: `https://${HOST}${path}`, width: 390, height: 844 });
  windows.push(window);
  const html = (await response.text()).replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
  window.document.write(html);
  const fetch = (url: string | URL, init: RequestInit = {}) => publisher.handle(new Request(new URL(String(url), `https://${HOST}`), {
    ...init, headers: { ...(init.headers as Record<string, string> ?? {}), host: HOST, origin: `https://${HOST}` },
  }), audience);
  Object.assign(window, { fetch, ResizeObserver: class { observe() {} disconnect() {} } });
  const copied: string[] = [];
  window.navigator.clipboard.writeText = async (text: string) => { copied.push(text); };
  new Function("w", `with (w) { ${READER_SCRIPT} }`)(window);
  const doc = window.document;
  // The threads route answered: the foot of the note is drawn.
  await until("the page's threads", () => doc.querySelector(".mg-whole"));
  const article = doc.querySelector("article")!;
  const words = (text: string) => [...article.querySelectorAll("p, li")].find((node) => node.textContent?.includes(text))!;
  const menu = () => doc.querySelector(".mark-menu");
  const rows = () => [...(menu()?.querySelectorAll("button") ?? [])].map((button) => button.textContent ?? "");
  const press = (label: string) => ([...(menu()?.querySelectorAll("button") ?? [])].find((button) => button.textContent === label) as HTMLElement | undefined)?.click();
  return { window, doc, words, menu, rows, press, copied };
}

test("signed in at phone width: a right-click opens the row's menu, Mark marks the row, and the foot marks the note", async () => {
  const page = await open(`/pub/p/${plan.id}?view=full`, "tailnet");
  const target = page.words("Chit them on the windowsill");
  expect(target).toBeTruthy();
  target.dispatchEvent(new page.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 200 }));
  await until("the menu", () => page.menu());
  expect(page.rows()).toEqual(expect.arrayContaining(["Mark", "Comment", "Copy", "Open", "Copy link"]));
  // Its rows are thumb-sized (PIE-1235's tap targets).
  expect(page.menu()!.getAttribute("role")).toBe("menu");
  expect(page.menu()!.classList.contains("mg-ui")).toBe(true);
  page.press("Mark");
  await until("the row's mark", () => new Marks(store.database).list({ blockId: row.id }).length);
  expect(new Marks(store.database).list({ blockId: row.id })[0]).toMatchObject({ author: "user", by: "user", surface: "web", span: { start: 0 } });
  expect(page.menu()).toBeNull();
  // Copy link copies the row's own page.
  target.dispatchEvent(new page.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 200 }));
  await until("the menu again", () => page.menu());
  page.press("Copy link");
  await until("the link copied", () => page.copied.length);
  expect(page.copied[0]).toBe(`https://${HOST}/pub/p/${row.id}`);
  // The foot: Mark this note, beside Comment on this note.
  const foot = [...page.doc.querySelectorAll(".mg-whole button")].map((button) => button.textContent);
  expect(foot).toEqual(expect.arrayContaining(["Comment on this note", "Mark this note"]));
  ([...page.doc.querySelectorAll(".mg-whole button")].find((button) => button.textContent === "Mark this note") as HTMLElement).click();
  await until("the note's mark", () => new Marks(store.database).list({ blockId: plan.id }).length);
});

test("a long press (touch) opens the same menu", async () => {
  const page = await open(`/pub/p/${plan.id}?view=full`, "tailnet");
  const target = page.words("What goes in the ground");
  // A finger's wobble keeps the press; a drag would end it.
  target.dispatchEvent(new page.window.PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", clientX: 30, clientY: 120 }));
  target.dispatchEvent(new page.window.PointerEvent("pointermove", { bubbles: true, pointerType: "touch", clientX: 33, clientY: 122 }));
  await until("the menu after a held press", () => page.menu(), 2000);
  expect(page.rows()).toEqual(expect.arrayContaining(["Mark", "Comment", "Open", "Copy link"]));
});

test("a share link's menu has no Mark, and its foot no Mark this note", async () => {
  const { share } = await client.request<{ share: ShareSession }>({ action: "shares.start", scope: plan.id });
  const base = new URL(share.url!).pathname.replace(/\/$/, "");
  const page = await open(`${base}/p/${plan.id}?view=full`, "public");
  page.words("Chit them on the windowsill").dispatchEvent(new page.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 200 }));
  await until("the share's menu", () => page.menu());
  expect(page.rows()).toEqual(expect.arrayContaining(["Comment", "Copy link"]));
  expect(page.rows()).not.toContain("Mark");
  expect([...page.doc.querySelectorAll(".mg-whole button")].map((button) => button.textContent)).not.toContain("Mark this note");
});
