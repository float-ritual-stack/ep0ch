// Readers show notes the way Detail does: a summary line instead of metadata lines, a property panel
// (copy, follow, edit by keys and agents), links by title, and transclusions with explicit failures.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { renderDoc } from "../src/doc";
import { DeliveryBoard } from "../src/desk/delivery";
import { embedRegion, invalidateEmbeds, MAX_EMBEDS, shade } from "../src/embeds";
import { answer, invalidateLive, resolveLive, setLiveSource } from "../src/live";
import { metadataLines, setUserSummaryKeys, summaryKeys, summarySegments, type Source } from "../src/props";
import { invalidateReferences, presentLinks, stripMarks } from "../src/refs";
import { MainMenu } from "../src/screens";
import { SocketBoard, type PropertyRecord } from "../src/socket";
import { width } from "../src/style";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { valueTarget } from "../src/surface/props-panel";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
const char = (ch: string): Key => ({ kind: "char", ch });
async function withState<T>(f: () => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "ep0ch-props-")), was = process.env.EP0CH_STATE, env = process.env.OUTLINER_PROPERTY_SUMMARY_KEYS;
  process.env.EP0CH_STATE = dir; delete process.env.OUTLINER_PROPERTY_SUMMARY_KEYS;
  try { return await f(); } finally {
    if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was;
    if (env === undefined) delete process.env.OUTLINER_PROPERTY_SUMMARY_KEYS; else process.env.OUTLINER_PROPERTY_SUMMARY_KEYS = env;
    rmSync(dir, { recursive: true, force: true });
  }
}
const P = (...kv: [string, string][]) => kv.map(([key, value]) => ({ key, value }));

describe("the summary line", () => {
  test("Detail's segments: stage label, repeats joined, a roadmap item's status left out, control characters dropped", () => {
    const props = P(["type", "roadmap-item"], ["status", "open"], ["work-stage", "doing"], ["priority", "high"], ["track", "soil"], ["track", "tools"], ["track", "soil"]);
    expect(summarySegments(props, ["status", "work-stage", "priority", "track"]).map(s => s.plain).join(" · ")).toBe("stage doing · priority high · track soil, tools");
    expect(summarySegments(P(["status", "open"]), ["status"]).map(s => s.plain)).toEqual(["status open"]);
    expect(summarySegments(P(["priority", "hi\x1b[31mgh"]), ["priority"])[0]!.value).toBe("hi[31mgh");
  });

  test("keys: the view's, then yours, then OUTLINER_PROPERTY_SUMMARY_KEYS (empty hides), then the default", () => withState(() => {
    expect(summaryKeys()).toEqual({ keys: ["status", "work-stage", "priority", "track"], source: "default" });
    process.env.OUTLINER_PROPERTY_SUMMARY_KEYS = " Priority, arc ,priority";
    expect(summaryKeys()).toEqual({ keys: ["priority", "arc"], source: "env" });
    process.env.OUTLINER_PROPERTY_SUMMARY_KEYS = "";
    expect(summaryKeys()).toEqual({ keys: [], source: "env" });
    setUserSummaryKeys(["project", "work-stage"]);
    expect(summaryKeys()).toEqual({ keys: ["project", "work-stage"], source: "yours" });
    expect(summaryKeys(["priority"])).toEqual({ keys: ["priority"], source: "view" });
    setUserSummaryKeys([]);
    expect(summaryKeys().keys).toEqual([]);
    setUserSummaryKeys(null);
    expect(summaryKeys().source).toBe("env");
  }));
});

describe("metadata lines", () => {
  const text = "Build the bin [type::roadmap-item]\n[priority::high] [track::soil]\n[track::tools] #garden\n\n## Outcome\nnote:: bare lines stay\nInline [x::y] stays.";
  const tok = (line: number, placement: PropertyRecord["placement"], scope: PropertyRecord["scope"]) =>
    ({ key: "k", value: "v", raw: "", start: 0, end: 0, line, column: 0, placement, syntax: "bracket", ordinal: 0, scope } as PropertyRecord);
  test("the service's block-scope metadata lines are left out; line and inline scope stay", () => {
    const tokens = [tok(0, "trailing-metadata", "block"), tok(1, "metadata-line", "block"), tok(2, "metadata-line", "block"), tok(5, "metadata-line", "line"), tok(6, "inline", "inline")];
    expect([...metadataLines(text, tokens)]).toEqual([1, 2]);
  });
  test("without properties.preview: the documented rule, the first run of property-only lines after the subject", () => {
    expect([...metadataLines(text, null)]).toEqual([1]);                        // `#garden` isn't a [key::value]: the run stops
    expect([...metadataLines("Title\n\n[a::b]\n[c::d]\nbody\n[e::f]", null)]).toEqual([2, 3]);
  });
});

/** A board that answers the reads the reader's links and embeds make, from a few fixed notes. */
function fakeSource(notes: Record<string, Msg>, redraw = () => {}): Source {
  const board: any = {
    resolveReferences: async (text: string) => [...text.matchAll(/\(\(([\w-]{8,})(?:\^([\w-]+))?(?:\|([^)]+))?\)\)/g)].map(([, id, frag, label]) => {
      const m = notes[id!];
      const status = !m ? "missing" : m.deleted ? "deleted" : frag && !m.text.includes(`^${frag}`) ? "stale" : "resolved";
      return { blockId: id, ...(frag ? { fragmentId: frag } : {}), ...(label ? { label } : {}), status, ...(m ? { title: m.text.split("\n")[0] } : {}) };
    }),
    resolvePage: async (address: string) => ({ address, status: address === "garden" ? "resolved" : "missing", ...(address === "garden" ? { block: notes.a } : {}) }),
    read: async (id: string) => { if (id === "ffffffff-dead-4000-8000-000000000000") throw new Error("socket closed"); return notes[id] ?? null; },
    readSavedView: async () => null,
    propertyRecords: async () => null,
    request: async () => ({ blocks: [], completeness: { kind: "complete" } }),
    listFields: () => ({}),
    toMsgs: () => [],
  };
  return { board, redraw };
}
const msg = (id: string, text: string, over: Partial<Msg> = {}): Msg => ({ id, text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", props: {}, revision: 1, ...over });
const A = "aaaaaaaa-1111-4111-8111-111111111111", T = "bbbbbbbb-2222-4222-8222-222222222222", GONE = "cccccccc-3333-4333-8333-333333333333";
const notes = { [A]: msg(A, "Garden plan\nBeans along the fence.\n## Beds ^beds\nTwo beds."), [T]: msg(T, "Old shed", { deleted: true }) };

describe("links read as titles", () => {
  test("titles, labels, fragments, trash and missing targets; code keeps its text; embeds are left for the renderer", async () => {
    const src = fakeSource(notes);
    const text = `See ((${A})), ((${A}|the plan)), ((${A}^beds)), ((${A}^nope)), ((${T})), ((${GONE}|old notes)), ((${GONE})), [[garden]], [[GDN-99|the bin]].\n\`((${A}))\`\n\`\`\`\n((${A}))\n\`\`\`\n!((${A}))`;
    presentLinks(text, true, src);
    await Bun.sleep(5);
    const out = stripMarks(presentLinks(text, true, src)).split("\n");
    expect(out[0]).toBe("See Garden plan, the plan, Garden plan^beds, Garden plan^nope · Missing fragment, Old shed · Trash, old notes · Missing target, cccccccc… · Missing target, garden, the bin · Missing target.");
    expect(out.slice(1)).toEqual([`\`((${A}))\``, "```", `((${A}))`, "```", `!((${A}))`]);
    // Inside an embed, an embed isn't expanded, and says so.
    presentLinks(`!((${A}))`, false, src); await Bun.sleep(5);
    expect(stripMarks(presentLinks(`!((${A}))`, false, src))).toBe("!Garden plan · embed not expanded here");
  });

  test("without a service the raw reference still reads short, never a crash", () => {
    expect(stripMarks(presentLinks(`((${A})) and ((${A}|label))`, true, null))).toBe("aaaaaaaa… and label");
  });
});

describe("transclusions", () => {
  test("each failure is explicit, a fragment shows the whole note with the PIE-404 note, and the 17th embed is the limit", async () => {
    invalidateEmbeds();
    const src = fakeSource(notes);
    const body = (m: Msg) => m.text.split("\n").slice(1);
    const region = (id: string, frag?: string, n = 0) => embedRegion(id, frag, n, 60, src, body).map(strip).map(l => l.trimEnd());
    for (const [id, frag] of [[A], [A, "beds"], [A, "nope"], [T], [GONE], ["ffffffff-dead-4000-8000-000000000000"]] as [string, string?][]) region(id, frag);
    await Bun.sleep(10);
    expect(region(A)).toEqual(["▌Embedded block · Garden plan", "▌ Beans along the fence.", "▌ ## Beds ^beds", "▌ Two beds."]);
    expect(region(A, "beds").slice(0, 2)).toEqual(["▌Embedded fragment · Garden plan ^beds", "▌the whole note is shown: fragment slices need PIE-404"]);
    expect(region(A, "nope")).toEqual(["▌!((aaaaaaaa…^nope)) · MISSING FRAGMENT"]);
    expect(region(T)).toEqual(["▌!((bbbbbbbb…)) · IN TRASH · Old shed"]);
    expect(region(GONE)).toEqual(["▌!((cccccccc…)) · MISSING TARGET"]);
    expect(region("ffffffff-dead-4000-8000-000000000000")).toEqual(["▌!((ffffffff…)) · TARGET FAILED · socket closed"]);
    expect(region(A, undefined, MAX_EMBEDS)).toEqual([`▌!((aaaaaaaa…)) · EMBED LIMIT · maximum ${MAX_EMBEDS} per note`]);
  });

  test("the renderer numbers embeds in reading order and keeps the text around them", () => {
    const seen: string[] = [];
    const doc = renderDoc(`Before !((${A})) between !((${A}^beds)) after\n- !((${T}))\n\`\`\`\n!((${A}))\n\`\`\``, {
      width: 70, cellW: 9, cellH: 16, graphics: false, maxImageRows: 4, unfold: false,
      embed: (id, frag, n) => { seen.push(`${n}:${id.slice(0, 4)}${frag ? `^${frag}` : ""}`); return [`[embed ${n}]`]; },
    });
    expect(seen).toEqual(["0:aaaa", "1:aaaa^beds", "2:bbbb"]);
    expect(doc.lines.map(strip)).toEqual(["Before", "[embed 0]", "between", "[embed 1]", "after", "[embed 2]", `│ !((${A}))`]);
  });

  test("a shaded line keeps its background through the resets inside it and fills the width", () => {
    for (const w of [4, 20, 61]) {
      const l = shade("\x1b[38;2;1;2;3mred\x1b[0m plain \x1b[0m", w);
      expect(width(l)).toBe(w);
      expect(l.split("\x1b[0m").slice(1, -1).every(part => part.startsWith("\x1b[48;2;"))).toBe(true);
    }
  });
});

describe("the surface: summary, panel and embeds at any width", () => {
  test("a roadmap-like note opens with the title, the summary line, then its body; i opens the panel", () => withState(async () => {
    const src = fakeSource(notes);
    const h: SurfaceHost = { ctx: { board: src.board, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false, copy() {} } as any, redraw() {}, navigate() {} };
    Object.assign(src.board, { ancestors: async () => [], comments: async () => [] });
    const text = `Build the compost bin [type::roadmap-item] [priority::high]\n[work-stage::doing] [track::soil]\n[track::tools] [related-to::${A}]\n\n## Outcome\nA bin by ((${A})).\n!((${A}))\n!((${GONE}))`;
    const m = msg("dddddddd-4444-4444-8444-444444444444", text, { properties: P(["type", "roadmap-item"], ["priority", "high"], ["work-stage", "doing"], ["track", "soil"], ["track", "tools"], ["related-to", A]), props: { type: "roadmap-item", priority: "high" } });
    const s = new NoteSurface();
    s.show(m, h);
    s.render(60, 40, h); await Bun.sleep(10);
    const lines = s.render(90, 40, h).lines.map(strip);
    expect(lines[0]!.trim()).toBe("Build the compost bin");
    expect(lines[1]!.trim()).toBe("stage doing · priority high · track soil, tools · i 6 properties");
    expect(lines.join("\n")).not.toContain("[work-stage::");
    expect(lines.join("\n")).toContain("A bin by Garden plan.");
    expect(lines.join("\n")).toContain("Embedded block · Garden plan");
    expect(lines.join("\n")).toContain("MISSING TARGET");
    s.key(char("i"), h);
    expect(s.holdsKeys && !s.editing).toBe(true);
    const panel = s.render(60, 40, h).lines.map(strip).join("\n");
    expect(panel).toContain("properties · 6");
    expect(panel.match(/track/g)?.length).toBeGreaterThanOrEqual(2);
    for (const w of [8, 14, 22, 30, 48]) {
      for (const full of [false, true]) {
        s.panel!.full = full;
        for (const l of s.render(w, 20, h).lines) expect({ w, full, over: width(l) > w ? strip(l) : null }).toEqual({ w, full, over: null });
      }
      s.panel = null;
      for (const l of s.render(w, 30, h).lines) expect({ w, over: width(l) > w ? strip(l) : null }).toEqual({ w, over: null });
      s.openPanel();
    }
    s.key({ kind: "esc" }, h);
    expect(s.panel).toBeNull();
  }));

  test("which values can be followed: blocks, pages and Work IDs, not the note's own addresses", () => {
    expect(valueTarget("related-to", A)).toEqual({ block: A });
    expect(valueTarget("depends-on", `((${A}|the plan))`)).toEqual({ block: A });
    expect(valueTarget("see", "[[garden|the plot]]")).toEqual({ page: "garden" });
    expect(valueTarget("issue", "GDN-12", "GDN")).toEqual({ page: "GDN-12" });
    expect(valueTarget("issue", "gdn-12", "GDN")).toEqual({ page: "gdn-12" });
    // Only the workspace's own prefix is a Work ID; other letters-digits values are just text.
    for (const [k, v] of [["sprint", "week-38"], ["encoding", "utf-8"], ["arc", "phase-2"], ["issue", "GDN-12"]]) expect(valueTarget(k!, v!, k === "issue" ? null : "GDN")).toBeNull();
    expect(valueTarget("work-id", "GDN-12", "GDN")).toBeNull();
    expect(valueTarget("page", "garden")).toBeNull();
    expect(valueTarget("priority", "high")).toBeNull();
  });
});

describe("live figures: the query grammar", () => {
  const block = (id: string, title: string) => ({ id, parentId: null, text: title, author: "agent", createdAt: "2026-09-25T00:00:00Z", updatedAt: "2026-09-25T00:00:00Z", properties: [] });
  const fake = (expression: boolean, seen: any[]): any => ({
    supports: (c: string) => (c === "query.expression" ? expression : undefined),
    request: async (_a: string, p: any) => { seen.push(p.query); return { blocks: [block("a", "Rake leaves")], completeness: { kind: "complete" } }; },
    toMsgs: (bs: any[]) => bs.map(b => ({ id: b.id, text: b.text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "agent", props: {} })),
  });

  test("OR / NOT / dates go to the service as an expression when it has query.expression", async () => {
    const seen: any[] = [];
    setLiveSource(fake(true, seen), () => {}); invalidateLive();
    const p = { query: "type=chore (priority=high OR due) updated > 2026-09-20" };
    answer(p); await until(() => answer(p)?.state === "ready", "the answer");
    expect(seen[0]).toMatchObject({ expression: p.query });
    expect(seen[0].filters).toBeUndefined();
  });

  test("without it: plain clauses still work, and anything more says which capability it needs", async () => {
    const seen: any[] = [];
    setLiveSource(fake(false, seen), () => {}); invalidateLive();
    const plain = { query: "type=chore priority=high" }, or = { query: "type=chore OR type=task" };
    answer(plain); answer(or);
    await until(() => answer(plain)?.state === "ready" && answer(or)?.state === "error", "the answers");
    expect(seen[0]).toMatchObject({ filters: [{ key: "type", value: "chore" }, { key: "priority", value: "high" }] });
    expect(answer(or)!.error).toBe("this query uses OR, which needs a service with query.expression (PIE-398)");
    expect(seen).toHaveLength(1);
    // done: is matched against each result here, so it stays plain clauses whatever the service has.
    expect(resolveLive("check", { query: "type=chore priority=high", done: "stage=done OR stage=dropped" })!.error).toContain("done: takes plain property clauses");
  });
});

// ── against a scratch outliner service ────────────────────────────────────────

describe.skipIf(!outliner)("the property panel and transclusions, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard, app: App, b: DeliveryBoard;
  let key: (k: Key) => void = () => {};
  const ids = {} as Record<"plan" | "shed" | "chores" | "nested" | "card", string>;
  const B = () => b as any;
  const AS = "test-agent-9";
  const act = (action: string, args: Record<string, unknown> = {}, reader = "preview") => app.act({ action, args, reader, as: AS }) as Promise<any>;
  const create = async (parentId: string | null, text: string) => (await board.request("create", { parentId, text, author: "agent" })).id as string;
  const current = async (id: string) => (await other.request("blocks.context", { blockId: id })).selected;
  const shown = (h = 60) => B().preview.render(110, h, true, b).lines.map(strip).join("\n") as string;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    delete process.env.OUTLINER_PROPERTY_SUMMARY_KEYS;
    board = new SocketBoard(await scratch.start());
    other = new SocketBoard(board.path);
    const hub = await create(null, "Allotment roadmap");
    await create(hub, "Doing [type::virtual-branch] [query::type=roadmap-item work-stage=doing]\n[summary-properties::priority,track]");
    ids.plan = await create(null, "Garden plan [page::garden]\nBeans along the fence.\n\n## Beds ^beds\nTwo raised beds.");
    ids.shed = await create(null, "Old shed notes");
    await board.request("delete", { blockId: ids.shed, author: "agent" });
    ids.chores = await create(null, "Queued chores\n[type::virtual-branch]\n[query::type=chore stage=queued]\n[summary-properties::priority]");
    await create(null, "Plant the beans [type::chore] [stage::queued] [priority::high]");
    ids.nested = await create(null, `Nested note\nIt embeds the plan: !((${ids.plan}))`);
    ids.card = await create(null, [
      "GDN-12 Build the compost bin",
      "[type::roadmap-item] [priority::high] [work-stage::doing] [project::garden]",
      `[track::soil] [track::tools] [related-to::${ids.plan}]`,
      "",
      "## Outcome",
      `Beside the beds in ((${ids.plan})), sized for [[garden]]. See [[GDN-99]].`,
      "owner:: the allotment group",
      "",
      `!((${ids.plan}))`, `!((${ids.plan}^beds))`, `!((${ids.plan}^compost))`, `!((${ids.chores}))`, `!((${ids.shed}))`,
      "!((0badc0de-0000-4000-8000-000000000000))", `!((${ids.nested}))`,
      ...Array.from({ length: 10 }, () => `!((${ids.plan}))`),
    ].join("\n"));
    const term = { info: { cols: 180, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    b = new DeliveryBoard(hub);
    app.push(new MainMenu()); app.push(b);
    await until(() => B().lanes.length === 1 && B().lanes[0].items?.length === 1, "the lane", 10_000);
    await act("open", { id: ids.card });
    await until(() => !B().preview.msg.partial, "the whole note");
  }, 30_000);

  afterAll(async () => {
    board?.close(); other?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("title, the lane's summary line, then the body: no metadata lines, links by title, every embed state", async () => {
    await until(() => { const s = shown(120); return s.includes("Embedded view · Queued chores · 1 result") && s.includes("MISSING FRAGMENT") && s.includes("!Garden plan · embed") && !s.includes("reading…"); }, "the embeds", 8000);
    const s = shown(120), lines = s.split("\n");
    expect(lines[0]!.trim()).toBe("GDN-12 Build the compost bin");
    expect(lines[1]!.trim()).toBe("priority high · track soil, tools · i 8 properties");   // the lane's [summary-properties::]
    expect(s).not.toContain("[type::");
    expect(s).toContain("Beside the beds in Garden plan, sized for garden. See GDN-99 · Missing target.");
    expect(s).toContain("owner:: the allotment group");                                   // a line-scope property is body text
    for (const want of ["Embedded block · Garden plan", "Embedded fragment · Garden plan ^beds", "fragment slices need PIE-404",
      "MISSING FRAGMENT", "∙ Plant the beans · priority high", "IN TRASH · Old shed notes", "!((0badc0de…)) · MISSING TARGET",
      "It embeds the plan: !Garden plan · embed not expanded here", `EMBED LIMIT · maximum 16 per note`]) expect(s).toContain(want);
    expect(s.match(/EMBED LIMIT/g)).toHaveLength(1);                                         // 17 embeds: the 17th is refused
    expect(s).not.toContain("## Beds ^beds");                                               // anchors are hidden when read
  });

  test("the panel: every token with scope, by keys and by an agent; copy returns the value", async () => {
    // One key from the lanes: the preview takes focus with its panel open.
    await act("focus", {}, "lanes");
    key(char("i"));
    expect([B().focus, !!B().preview.surface.panel]).toEqual(["preview", true]);
    const r = await act("props");
    expect(r.rows.map((x: any) => `${x.key}=${x.value}:${x.scope}`)).toEqual([
      "type=roadmap-item:block", "priority=high:block", "work-stage=doing:block", "project=garden:block", "track=soil:block", "track=tools:block",
      `related-to=${ids.plan}:block`, "owner=the allotment group:line",
    ]);
    expect(r.rows.find((x: any) => x.key === "related-to")).toMatchObject({ target: { block: ids.plan } });
    // Tab moves between values inside the panel instead of moving the board's focus.
    key({ kind: "tab" }); key({ kind: "tab" });
    expect([B().focus, B().preview.surface.panel.sel]).toEqual(["preview", 2]);
    await expect(act("props.copy", { key: "track" })).rejects.toThrow("pass n");
    // An agent gets the value in its reply; the person's panel selection and clipboard stay as they were.
    expect(await act("props.copy", { n: 6 })).toMatchObject({ key: "track", value: "tools" });
    expect(B().preview.surface.panel.sel).toBe(2);
    expect(shown()).not.toContain("copied track");
  });

  test("an edit is one revision-checked properties.patch, recorded as whoever made it; a stale one is refused", async () => {
    const before = await current(ids.card);
    const r = await act("props.edit", { key: "priority", value: "medium", revision: before.revision });
    expect(r).toMatchObject({ saved: true, from: "high", to: "medium", revision: before.revision + 1 });
    const now = await current(ids.card);
    expect(now.text).toBe(before.text.replace("[priority::high]", "[priority::medium]"));
    const log = await other.request("activity.recent", { author: "agent", limit: 20 });
    expect(log.entries.find((x: any) => x.block.id === ids.card)).toMatchObject({ author: "agent", actorId: AS });
    await expect(act("props.edit", { key: "priority", value: "low", revision: before.revision })).rejects.toThrow(`is at revision ${now.revision}`);
    // By keys: open the field, and while it's open someone else saves the note. Enter is refused, nothing overwritten.
    await until(() => B().preview.msg.revision === now.revision, "the reader to catch up");
    const P = B().preview.surface.panel;
    P.sel = 3;                                                                                // project
    key({ kind: "enter" }); for (const c of "-east") key(char(c));
    expect(B().preview.surface.editing).toBe(true);
    await other.update(ids.card, now.text.replace("Beside the beds", "Next to the beds"), now.revision);
    await until(() => !!P.field?.changedElsewhere, "changed elsewhere", 5000);
    key({ kind: "enter" });
    await until(() => !!P.field && !P.field.saving && P.field.note.includes("not saved"), "the refusal", 5000);
    const after = await current(ids.card);
    expect(after.text).toContain("[project::garden]");
    expect(after.text).toContain("Next to the beds");
    key({ kind: "esc" });
    expect(P.field).toBeNull();
  });

  test("follow: a block value opens its target; a missing Work ID says so; the summary choice is yours", async () => {
    await act("open", { id: ids.card });
    await until(() => !B().preview.msg.partial, "the note");
    const r = await act("props.follow", { key: "related-to" });
    expect(r).toMatchObject({ opened: ids.plan, title: "Garden plan" });
    await act("open", { id: ids.card });
    await expect(act("props.follow", { key: "project" })).rejects.toThrow("plain text");
    const s = await act("props.summary", { keys: "project, work-stage" });
    expect(s.yours).toEqual({ keys: ["project", "work-stage"], source: "yours" });
    expect(s.here.source).toBe("view");                                                    // the lane still decides for its cards
    await act("props.summary", { reset: true });
  });

  test("requests: an unrelated change asks nothing again, a note's references resolve once, embed targets are read together", async () => {
    const counts: Record<string, number> = {};
    const request = board.request.bind(board);
    const tally = () => ({ ...counts });
    const reset = () => { for (const k of Object.keys(counts)) delete counts[k]; };
    (board as any).request = (action: string, params: any = {}) => {
      const k = action === "blocks.read" ? (params.fields?.includes("text") ? "blocks.read+text" : "blocks.read(lanes)")
        : action === "references.resolve" && !params.text ? "prefix" : action;
      counts[k] = (counts[k] ?? 0) + 1;
      return request(action, params);
    };
    const settled = async (what: string) => { await until(() => { const s = shown(120); return s.includes("Embedded view · Queued chores") && !s.includes("reading…"); }, what, 8000); await Bun.sleep(300); shown(120); await Bun.sleep(200); };
    try {
      await act("open", { id: ids.card });
      await act("props.close");
      await settled("the embeds");
      // 1. Someone edits a note this card neither links nor embeds.
      const bystander = await create(null, "A bystander note");
      await Bun.sleep(300);
      reset();
      const events = (app as any).events;
      const b0 = await current(bystander);
      await other.update(bystander, "A bystander note, edited", b0.revision);
      await until(() => (app as any).events > events, "the event");
      await settled("the redraw");
      const unrelated = tally();
      console.log(`  requests after an unrelated edit: ${JSON.stringify(unrelated)}`);
      expect(unrelated["references.resolve"] ?? 0).toBe(0);
      expect(unrelated["blocks.context"] ?? 0).toBe(0);
      expect(unrelated["prefix"] ?? 0).toBe(0);
      expect(unrelated["pages.resolve"] ?? 0).toBeLessThanOrEqual(1);       // [[GDN-99]] is missing: any edit could add it
      expect(unrelated["blocks.read+text"] ?? 0).toBeLessThanOrEqual(1);    // the embedded view's definition, with its results
      // 2. Everything again (a reset): the card's embed targets in one blocks.read.
      reset();
      invalidateEmbeds();
      await settled("the embeds again");
      const all = tally();
      console.log(`  requests to re-read every embed: ${JSON.stringify(all)}`);
      expect(all["blocks.read+text"]).toBe(1);
      expect(all["blocks.context"] ?? 0).toBeLessThanOrEqual(1);            // the trashed target, for its title
      // 3. A note whose body links a target by label and whose property holds the same target's id.
      const linked = await create(null, `Linked note [related-to::${ids.plan}]\nSee ((${ids.plan}|the plan)) and ((${ids.plan})).`);
      reset();
      await act("open", { id: linked });
      await until(() => !B().preview.msg.partial, "the note");
      B().preview.surface.openPanel();
      await until(() => { const s = shown(); return s.includes("See the plan and Garden plan.") && /related-to\s+Garden plan/.test(s); }, "the links and the panel", 8000);
      const once = tally();
      console.log(`  requests to open a note with links and a block-valued property: ${JSON.stringify(once)}`);
      expect(once["references.resolve"]).toBe(1);
      B().preview.surface.panel = null;
    } finally { (board as any).request = request; }
  }, 30_000);

  test("embeds refresh when their target changes", async () => {
    await act("open", { id: ids.card });
    await act("props.close");
    await until(() => shown(120).includes("Beans along the fence."), "the embed");
    const plan = await current(ids.plan);
    await other.update(ids.plan, plan.text.replace("Beans along the fence.", "Peas along the fence."), plan.revision);
    await until(() => shown(120).includes("Peas along the fence."), "the refreshed embed", 8000);
    invalidateReferences();
  });
});

// ── review fixes: each test fails without its fix ─────────────────────────────

const AGENT = { kind: "agent", id: "test-agent-7" } as const;
const tok = (key: string, value: string, line: number, ordinal: number, over: Partial<PropertyRecord> = {}): PropertyRecord =>
  ({ key, value, raw: `[${key}::${value}]`, start: 0, end: 0, line, column: 0, placement: "metadata-line", syntax: "bracket", ordinal, scope: "block", ...over });

/** A reader on a fake board: property reads answer from `tokens` (or wait, when it returns a promise). */
function panelRig(text: string, tokens: (text: string) => PropertyRecord[] | Promise<PropertyRecord[]>) {
  const ID = "eeeeeeee-5555-4555-8555-555555555555";
  const patches: { revision: number; ops: unknown[] }[] = [], copied: string[] = [];
  const board: any = {
    propertyRecords: async (t: string) => tokens(t),
    patchProperties: async (id: string, revision: number, ops: unknown[]) => { patches.push({ revision, ops }); return msg(id, text, { revision: revision + 1 }); },
    workIdPrefix: async () => null, resolveReferences: async () => [], resolvePage: async (address: string) => ({ address, status: "missing" }),
    ancestors: async () => [], comments: async () => [], get: async () => null, read: async () => null,
  };
  const h: SurfaceHost = { ctx: { board, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false, copy: (v: string) => copied.push(v) } as any, redraw() {}, navigate() {} };
  const s = new NoteSurface();
  const m = msg(ID, text, { revision: 1, properties: P(["priority", "high"], ["track", "soil"]), props: { priority: "high", track: "soil" } });
  s.show(m, h);
  return { s, h, m, patches, copied, ID };
}

describe("review: property actions", () => {
  test("an agent's edit uses the revision its ordinals came from, and is refused when the note moved while they were read", async () => {
    const text = "Card\n[priority::high] [track::soil]";
    let release: ((t: PropertyRecord[]) => void) | null = null;
    const { s, h, patches, ID } = panelRig(text, t => (t === text ? new Promise(r => { release = r; }) : [tok("owner", "x", 1, 0), tok("priority", "high", 1, 1), tok("track", "soil", 1, 2)]));
    const p = s.act("props.edit", { key: "track", value: "tools" }, h, AGENT);
    p.catch(() => {});
    await until(() => release !== null, "the property read");
    // An event lands while the tokens are on their way: the note gained a property before track.
    s.refresh(msg(ID, "Card\n[owner::x] [priority::high] [track::soil]", { revision: 2, properties: P(["owner", "x"], ["priority", "high"], ["track", "soil"]) }));
    release!([tok("priority", "high", 1, 0), tok("track", "soil", 1, 1)]);
    await expect(p).rejects.toThrow("changed while");
    expect(patches).toEqual([]);                                  // never ordinal 1 (now priority) at revision 2
  });

  test("agent props, props.copy and props.edit leave the person's reader as it was, and never touch the clipboard", async () => {
    const text = "Card\n[priority::high] [track::soil]";
    const { s, h, patches, copied } = panelRig(text, () => [tok("priority", "high", 1, 0), tok("track", "soil", 1, 1)]);
    const listed = await s.act("props", {}, h, AGENT) as any;
    expect(listed.rows.map((r: any) => r.key)).toEqual(["priority", "track"]);
    expect(await s.act("props.copy", { n: 2 }, h, AGENT)).toMatchObject({ key: "track", value: "soil" });
    expect(await s.act("props.edit", { key: "priority", value: "low" }, h, AGENT)).toMatchObject({ saved: true, to: "low" });
    expect([s.panel, s.holdsKeys, copied]).toEqual([null, false, []]);
    expect(patches).toEqual([{ revision: 1, ops: [{ op: "replace", ordinal: 0, value: "low" }] }]);
    // The person's own panel: an agent doesn't move its selection or open a field in it.
    s.key(char("i"), h); s.key({ kind: "tab" }, h);
    await s.act("props.copy", { n: 1 }, h, AGENT);
    expect([s.panel?.sel, s.panel?.field ?? null, copied]).toEqual([1, null, []]);
    // Only the person's `y` copies to the clipboard.
    s.key(char("y"), h);
    expect(copied).toEqual(["soil"]);
  });

  test("with the panel open, PgDn, PgUp and Space still scroll (the note inline, the list when full)", () => {
    const body = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
    const { s, h } = panelRig(`Card\n[priority::high]\n\n${body}`, () => [tok("priority", "high", 1, 0)]);
    s.key(char("i"), h);
    s.key({ kind: "pgdn" }, h);
    expect(s.scroll).toBe(15);
    s.key(char(" "), h);
    expect(s.scroll).toBe(30);
    s.key({ kind: "pgup" }, h);
    expect(s.scroll).toBe(15);
    expect(s.panel).not.toBeNull();
    // While a value is typed, Space is text.
    s.key({ kind: "enter" }, h); s.key(char(" "), h);
    expect([s.scroll, s.panel!.field!.text]).toEqual([15, "high "]);
  });
});

describe("review: what the reader hides and expands", () => {
  test("only the preamble run is hidden: a hashtag-only line in the body stays", () => {
    const text = "Title\n[a::b] [c::d]\n#garden\n\nBody text\n#compost\nmore";
    const tokens = [tok("a", "b", 1, 0), tok("c", "d", 1, 1), tok("tag", "garden", 2, 2, { syntax: "hashtag" }), tok("tag", "compost", 5, 3, { syntax: "hashtag" })];
    expect([...metadataLines(text, tokens)]).toEqual([1, 2]);
    expect([...metadataLines("Title\n\n#only-tags\nbody\n#late", [tok("tag", "only-tags", 2, 0, { syntax: "hashtag" }), tok("tag", "late", 4, 1, { syntax: "hashtag" })])]).toEqual([2]);
  });

  test("a transclusion inside inline code stays code", () => {
    const seen: string[] = [];
    const doc = renderDoc(`Write \`!((${A}))\` to embed, like !((${A})) here`, {
      width: 70, cellW: 9, cellH: 16, graphics: false, maxImageRows: 4, unfold: false,
      embed: (id, _f, n) => { seen.push(`${n}:${id.slice(0, 4)}`); return [`[embed ${n}]`]; },
    });
    expect(seen).toEqual(["0:aaaa"]);
    expect(doc.lines.map(strip)).toEqual(["Write !((aaaaaaaa…)) to embed, like", "[embed 0]", "here"]);   // code, drawn as code
  });

  test("a failed properties.preview is asked again after the next outline event, not on every redraw", async () => {
    const { tokensOf, invalidatePropertyErrors } = await import("../src/props") as any;
    let asked = 0, fail = true;
    const src: Source = { board: { propertyRecords: async () => { asked++; if (fail) throw new Error("socket closed"); return []; } } as any, redraw() {} };
    expect(tokensOf("T\n[a::b]", src)).toBeNull();
    await until(() => tokensOf("T\n[a::b]", src)?.state === "error", "the error");
    for (let i = 0; i < 5; i++) tokensOf("T\n[a::b]", src);
    expect(asked).toBe(1);
    fail = false;
    invalidatePropertyErrors();
    tokensOf("T\n[a::b]", src);
    await until(() => tokensOf("T\n[a::b]", src)?.state === "ready", "the retry");
    expect(asked).toBe(2);
  });

  test("a read asked again isn't the one a full cache lets go: an action waits on it, not on a second read", async () => {
    const { tokensOf, tokensFor, invalidatePropertyErrors } = await import("../src/props") as any;
    const K = "Oldest\n[shelf::top]";
    const asked: string[] = [];
    let release = () => {};
    const held = new Promise<void>(r => { release = r; });
    let fail = true;
    const src: Source = { board: { propertyRecords: async (t: string) => {
      asked.push(t);
      if (t !== K) return [];
      if (fail) throw new Error("socket closed");
      await held; return [];
    } } as any, redraw() {} };
    // K fails first, so it holds the oldest place; 299 more texts fill the cache.
    tokensOf(K, src);
    await until(() => tokensOf(K, src)?.state === "error", "the error");
    for (let i = 0; i < 299; i++) tokensOf(`Jar ${i}\n[shelf::${i}]`, src);
    await until(() => tokensOf("Jar 298\n[shelf::298]", src)?.state === "ready", "the jars");
    fail = false;
    invalidatePropertyErrors();
    const waiting = tokensFor(K, src);                    // asked again, still in flight…
    tokensOf("Newest\n[shelf::low]", src);               // …when one more text comes in
    const again = tokensFor(K, src);
    release();
    expect((await waiting).state).toBe("ready");
    expect((await again).state).toBe("ready");
    expect(asked.filter(t => t === K)).toHaveLength(2);   // the failure and its one retry
  });
});

describe("review: snapshot write scenarios are scratch-only", () => {
  const run = (env: Record<string, string>) => {
    const home = mkdtempSync(join(tmpdir(), "ep0ch-home-"));
    try {
      const p = Bun.spawnSync(["bun", "scripts/snap.ts", "props"], { cwd: join(import.meta.dir, ".."), env: { PATH: process.env.PATH!, HOME: home, EP0CH_SNAP_WRITES: "1", ...env }, stdout: "pipe", stderr: "pipe" });
      return { code: p.exitCode, err: p.stderr.toString() };
    } finally { rmSync(home, { recursive: true, force: true }); }
  };
  test("no EP0CH_SOCKET: refused before connecting (never the default socket)", () => {
    const r = run({});
    expect(r.code).toBe(2);
    expect(r.err).toContain("EP0CH_SOCKET");
  });
  test("a socket outside the temp dir: refused before connecting", () => {
    const r = run({ EP0CH_SOCKET: "/var/lib/not-a-scratch/outliner.sock" });
    expect(r.code).toBe(2);
    expect(r.err).toContain("temp");
  });
});
