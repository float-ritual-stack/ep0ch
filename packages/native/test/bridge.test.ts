// The bridge as the native app uses it: a scratch host, a few made-up notes, and the bridge's own stdin and stdout.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { Scratch } from "@ep0ch/door/test/scratch";
import { SocketBoard } from "@ep0ch/door/src/socket";
import type { Page, Part, Row } from "../bridge/page";

type Said = { id?: number; ok?: boolean; result?: any; error?: string; kind?: string; event?: string; ids?: string[] };

/** One running bridge: `ask` sends a line and resolves with its answer; `events` holds what it said unasked. */
class Bridge {
  private proc: Subprocess<"pipe", "pipe", "inherit">;
  private waiting = new Map<number, (said: Said) => void>();
  private next = 0;
  readonly events: Said[] = [];
  readonly ready: Promise<void>;
  constructor(env: Record<string, string>, args: string[]) {
    this.proc = Bun.spawn(["bun", join(import.meta.dir, "../bridge/main.ts"), ...args], { env: { ...process.env, ...env }, stdin: "pipe", stdout: "pipe", stderr: "inherit" });
    let ready!: () => void;
    this.ready = new Promise(r => { ready = r; });
    const out = this.proc.stdout;
    void (async () => {
      let buffer = "";
      for await (const chunk of out.pipeThrough(new TextDecoderStream())) {
        buffer += chunk;
        for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
          const said = JSON.parse(buffer.slice(0, at)) as Said;
          buffer = buffer.slice(at + 1);
          if (said.event === "ready") ready();
          else if (said.id !== undefined) { this.waiting.get(said.id)?.(said); this.waiting.delete(said.id); }
          else this.events.push(said);
        }
      }
    })();
  }
  ask(op: string, more: Record<string, unknown> = {}): Promise<Said> {
    const id = ++this.next;
    return new Promise(resolve => { this.waiting.set(id, resolve); this.proc.stdin.write(JSON.stringify({ id, op, ...more }) + "\n"); });
  }
  async result<T = any>(op: string, more: Record<string, unknown> = {}): Promise<T> {
    const said = await this.ask(op, more);
    if (!said.ok) throw new Error(`${op} refused (${said.kind}): ${said.error}`);
    return said.result as T;
  }
  async close() { this.proc.stdin.end(); await this.proc.exited; }
}

const scratch = new Scratch();
let bridge: Bridge;
let shed = "", plan = "", onions = "";

beforeAll(async () => {
  await scratch.start();
  const board = new SocketBoard(scratch.sock, 15_000, scratch.name);
  shed = (await board.createBlock(null, "Shed [type::place]\nWhere the tools live.")).id;
  onions = (await board.createBlock(shed, "Lift the onions [type::chore] [area::plot]\nBefore the rain.")).id;
  await board.createBlock(shed, "Water the beans [type::chore] [area::plot]");
  plan = (await board.createBlock(null, [
    "Plan for Saturday [type::plan]",
    `Start at the ((${shed})), then ((${onions}|the onions)) and the [[Seed list]].`,
    "A second line.",
    "",
    "::links{query=\"type=chore area=plot\" title=\"On the plot\"}",
    "::",
    "",
    "> [!tip] Bring gloves",
    "> The brambles are back.",
    "",
    "::links{query=\"type!=chore\" title=\"Not chores\"}",
    "::",
  ].join("\n"))).id;
  board.close();
  bridge = new Bridge(scratch.env, ["--ws", scratch.name]);
  await bridge.ready;
}, 60_000);

afterAll(async () => { await bridge?.close(); await scratch.dispose(); });

const component = (p: Page, title: string) => p.parts.find((part): part is Extract<Part, { kind: "component" }> => part.kind === "component" && part.title === title)!;

test("hello names the outline and the host's outlines", async () => {
  const hello = await bridge.result("hello");
  expect(hello.outline).toBe(scratch.name);
  expect(hello.outlines).toContain(scratch.name);
});

test("the tree is every note in walk order, by title, with its depth", async () => {
  const { rows } = await bridge.result<{ rows: { id: string; title: string; depth: number; parent: string | null; hasChildren: boolean }[] }>("tree");
  const at = rows.findIndex(r => r.id === shed);
  expect(rows[at]).toMatchObject({ title: "Shed", depth: 0, hasChildren: true, kind: "place" });
  expect(rows[at + 1]).toMatchObject({ id: onions, title: "Lift the onions", depth: 1, parent: shed });
});

test("a page is the title, the chips and the body in parts the app can draw", async () => {
  const page = await bridge.result<Page>("page", { note: plan });
  expect(page.title).toBe("Plan for Saturday");
  expect(page.chips).toEqual([{ key: "type", value: "plan" }]);
  expect(page.text.startsWith("Plan for Saturday [type::plan]\n")).toBe(true);

  const prose = page.parts.filter(p => p.kind === "prose").map(p => p.markdown);
  // References read as Markdown links: an unlabelled one by its note's title, a labelled one by its label, a page by its name.
  expect(prose[0]).toContain(`[Shed](ep0ch:b/${shed})`);
  expect(prose[0]).toContain(`[the onions](ep0ch:b/${onions})`);
  expect(prose[0]).toContain("[Seed list](ep0ch:p/Seed%20list)");
  // Two written lines stay two lines.
  expect(prose[0]).toContain(".  \nA second line.");
  // A callout's header is a lead in its quote.
  expect(prose.join("\n")).toMatch(/> \*\*.*Bring gloves\*\*/);
  expect(prose.join("\n")).not.toContain("[!tip]");
});

test("a query-backed component arrives answered; one the service can't read arrives with the service's words", async () => {
  const page = await bridge.result<Page>("page", { note: plan });
  const plot = component(page, "On the plot");
  expect(plot.name).toBe("links");
  expect(plot.query).toBe("type=chore area=plot");
  expect(plot.rows!.map((r: Row) => r.title).sort()).toEqual(["Lift the onions", "Water the beans"]);
  const bad = component(page, "Not chores");
  expect(bad.rows).toBeUndefined();
  expect(bad.error).toMatch(/NOT/);
  // Its source is still there to show.
  expect(bad.source).toContain("::links{");
});

test("children and backlinks come with the page", async () => {
  const page = await bridge.result<Page>("page", { note: shed });
  expect(page.children.map(c => c.title)).toEqual(["Lift the onions", "Water the beans"]);
  expect(page.backlinks.map(b => b.id)).toContain(plan);
});

test("a link is followed by the bridge: a block by id, a page that isn't there yet refused as not found", async () => {
  expect(await bridge.result("follow", { href: `ep0ch:b/${shed}` })).toEqual({ id: shed });
  const missing = await bridge.ask("follow", { href: "ep0ch:p/Seed%20list" });
  expect(missing).toMatchObject({ ok: false, kind: "not-found" });
});

test("a save names the revision it read: the next one lands, a stale one is refused by kind and writes nothing", async () => {
  const before = await bridge.result<Page>("page", { note: onions });
  const saved = await bridge.result<Page>("save", { note: onions, revision: before.revision, text: `${before.text}\nTake the fork.` });
  expect(saved.revision).toBe(before.revision + 1);
  expect(saved.text).toEndWith("Take the fork.");
  expect(saved.author).toStartWith("ep0ch-native:");

  const stale = await bridge.ask("save", { note: onions, revision: before.revision, text: "Lost" });
  expect(stale).toMatchObject({ ok: false, kind: "stale-revision" });
  expect((await bridge.result<Page>("page", { note: onions })).text).toEndWith("Take the fork.");
});

test("what changes in the outline is said as an event naming the note", async () => {
  const board = new SocketBoard(scratch.sock, 15_000, scratch.name);
  const made = await board.createBlock(shed, "Oil the shears [type::chore]");
  board.close();
  const end = Date.now() + 5000;
  while (!bridge.events.some(e => e.event === "changed" && e.ids?.includes(made.id)) && Date.now() < end) await Bun.sleep(25);
  expect(bridge.events.some(e => e.event === "changed" && e.ids?.includes(made.id))).toBe(true);
});

test("create, move, trash and restore go through the service", async () => {
  const { id } = await bridge.result<{ id: string }>("create", { parent: shed, text: "Sharpen the hoe [type::chore]" });
  let page = await bridge.result<Page>("page", { note: id });
  expect(page.title).toBe("Sharpen the hoe");
  expect((await bridge.result<Page>("page", { note: shed })).children.at(-1)!.id).toBe(id);

  await bridge.result("move", { note: id, revision: page.revision, step: "up" });
  const kids = (await bridge.result<Page>("page", { note: shed })).children.map(c => c.id);
  expect(kids.indexOf(id)).toBe(kids.length - 2);

  await bridge.result("trash", { note: id });
  expect((await bridge.result<Page>("page", { note: shed })).children.map(c => c.id)).not.toContain(id);
  await bridge.result("restore", { note: id });
  page = await bridge.result<Page>("page", { note: id });
  expect(page.title).toBe("Sharpen the hoe");
});

test("find ranks notes by words; a query answers rows with the facets they carry, and a key nobody wrote gets the service's hint", async () => {
  const found = await bridge.result<{ rows: Row[] }>("search", { query: "onions" });
  expect(found.rows.map(r => r.id)).toContain(onions);

  const q = await bridge.result<{ rows: Row[]; facets: { key: string; values: { value: string; count: number }[] }[]; hint: string }>("query", { where: "type=chore" });
  expect(q.rows.map(r => r.title)).toContain("Lift the onions");
  // Facets are whatever keys the matches carry: nothing here names `area`.
  expect(q.facets.find(f => f.key === "area")?.values).toContainEqual({ value: "plot", count: 2 });

  const typo = await bridge.result<{ rows: Row[]; hint: string }>("query", { where: "tpye=chore" });
  expect(typo.rows).toEqual([]);
  expect(typo.hint).toContain("type");
});
