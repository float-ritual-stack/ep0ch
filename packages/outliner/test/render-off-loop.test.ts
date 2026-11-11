// PIE-1602: a render script draws off the outline host's loop. A tile left open never makes another door wait: its VM
// spins on a worker, its request holds nothing behind it on its connection, and past its budget its tile says so.
// Fictional outline; a scratch store and service per test.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";

let root: string;
let store: OutlinerStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "render-off-loop-"));
  store = new OutlinerStore(join(root, "outline.sqlite"));
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

function door(socketPath: string) {
  const socket = connect(socketPath);
  const waiting = new Map<string, (r: { ok: boolean; result?: any; error?: string }) => void>();
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const line = JSON.parse(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      if (line.id) waiting.get(line.id)?.(line);
    }
  });
  return { socket, request: (input: Record<string, unknown>) => new Promise<{ ok: boolean; result?: any; error?: string }>(resolve => {
    const id = crypto.randomUUID();
    waiting.set(id, resolve);
    socket.write(`${JSON.stringify({ id, ...input })}\n`);
  }) };
}

const script = (name: string, code: string) => store.create(`${name} [script::${name}] [mode::render]\n\`\`\`js\n${code}\n\`\`\``);

async function host() {
  const server = new OutlinerServer(store, join(root, "service.sock"));
  await server.start();
  return { server, path: join(root, "service.sock") };
}

/** The longest the loop went without getting back to a timer while `work` ran. */
async function loopLag<T>(work: () => Promise<T>): Promise<{ value: T; worst: number }> {
  let worst = 0, last = performance.now();
  const timer = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last - 10); last = now; }, 10);
  try { return { value: await work(), worst }; } finally { clearInterval(timer); }
}

test("a render script that spins for 3 s: a page resolves in under a second, on its door's connection and another door's, and its tile is drawn", async () => {
  store.create("Hen house [page::hen-house]");
  script("slow-sheet", `const until = Date.now() + 3000; while (Date.now() < until) {} return "drawn";`);
  const { server, path } = await host();
  const drawing = door(path), reader = door(path);
  try {
    const started = performance.now();
    const tile = drawing.request({ action: "scripts.render", of: "slow-sheet", props: {}, deadlineMs: 15_000 }).then(r => ({ r, ms: performance.now() - started }));
    await Bun.sleep(300);
    const { value: asked, worst } = await loopLag(async () => {
      const elsewhere = performance.now();
      const other = await reader.request({ action: "pages.resolve", address: "hen-house" });
      const otherMs = performance.now() - elsewhere;
      const here = performance.now();
      const same = await drawing.request({ action: "pages.resolve", address: "hen-house" });
      return { other, otherMs, same, sameMs: performance.now() - here };
    });
    expect(asked.other.result?.block?.id).toBeDefined();
    expect(asked.otherMs).toBeLessThan(1000);
    expect(asked.same.result?.block?.id).toBeDefined();
    expect(asked.sameMs).toBeLessThan(1000);
    expect(worst).toBeLessThan(1000);
    const { r, ms } = await tile;
    expect(r.result?.markdown).toBe("drawn");
    // It really was drawing all that while: the page didn't resolve because the script had finished.
    expect(ms).toBeGreaterThan(2900);
  } finally {
    drawing.socket.destroy(); reader.socket.destroy();
    await server.close();
  }
}, 30_000);

test("a render script that never ends is cut off at its budget: the loop goes on, and what its tile shows says so and nothing else", async () => {
  store.create("Hen house [page::hen-house]");
  script("endless-sheet", "while (true) {}");
  const { server, path } = await host();
  const drawing = door(path), reader = door(path);
  try {
    const started = performance.now();
    const tile = drawing.request({ action: "scripts.render", of: "endless-sheet", props: {}, deadlineMs: 1500 });
    const { value: page, worst } = await loopLag(() => reader.request({ action: "pages.resolve", address: "hen-house" }));
    expect(page.result?.block?.id).toBeDefined();
    expect(worst).toBeLessThan(1000);
    const cut = await tile;
    expect(performance.now() - started).toBeLessThan(5000);
    expect(cut.ok).toBe(false);
    expect(cut.error).toBe("drawing took too long: it ran past its 1.5 s budget and was stopped");
  } finally {
    drawing.socket.destroy(); reader.socket.destroy();
    await server.close();
  }
}, 30_000);

// PIE-1604 (#1386): the render-vs-action advice is for a render that tried to write; a script that throws on its own
// says its own words and nothing about writing (script-site.test.ts holds the write case).
test("a render script that fails on its own says its own error, with no advice about writing", async () => {
  script("broken-sheet", `throw new Error("the hens are out");`);
  const { server, path } = await host();
  const drawing = door(path);
  try {
    const failed = await drawing.request({ action: "scripts.render", of: "broken-sheet", props: {}, deadlineMs: 5000 });
    expect(failed.error).toContain("the hens are out");
    expect(failed.error).not.toContain("render scripts draw");
  } finally {
    drawing.socket.destroy();
    await server.close();
  }
}, 30_000);

// PIE-1739: a drawing reads the registry as it stands rather than every folder and script note again; what changed since
// still draws at once. A script note written, then edited, through the service is drawn as written the moment after.
test("a render script written or edited through the service draws as written on the next drawing", async () => {
  const { server, path } = await host();
  const drawing = door(path);
  try {
    const made = await drawing.request({ action: "create", parentId: null, text: "Seed count [script::seed-count] [mode::render]\n```js\nreturn \"twelve trays\";\n```", author: "user" });
    expect(made.ok, made.error).toBe(true);
    expect((await drawing.request({ action: "scripts.render", of: "seed-count", props: {}, deadlineMs: 5000 })).result.markdown).toContain("twelve trays");
    const edited = await drawing.request({ action: "update", blockId: made.result.id, expectedRevision: made.result.revision, text: "Seed count [script::seed-count] [mode::render]\n```js\nreturn \"fourteen trays\";\n```", mutation: { author: "user" } });
    expect(edited.ok, edited.error).toBe(true);
    expect((await drawing.request({ action: "scripts.render", of: "seed-count", props: {}, deadlineMs: 5000 })).result.markdown).toContain("fourteen trays");
  } finally {
    drawing.socket.destroy();
    await server.close();
  }
}, 30_000);
