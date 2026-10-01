// PIE-512: the four extension kinds in the door, against a scratch service with the outliner's example
// extensions installed in the scratch outline's own `extensions/` folder (never a real outline, never the
// person's user folder). A reader draws a `moon::` record, a `horoscope::` output, a `fancy-horror::`
// component from its primitives and an `@tidy` request with its state; the component's `ward` runs by its
// key, a click on its control and `act`, attributed `ext:fancy-horror`; `r` runs a line again; the `tarot`
// tile kind registers from `extensions.list`, opens by ^W o and `act`, saves its block and comes back after a
// restart; and an extension removed while the door runs goes away (its tile says so) and comes back.
// Fictional notes only; the extensions' content is made up.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { primitiveLines } from "../src/components";
import { Desk } from "../src/desk/desk";
import { kindForKey, tileKind } from "../src/desk/tile-kinds";
import { bindExtensions, EXT_ACTIONS, extensionList, loadExtensions, mentionsExtension } from "../src/extensions";
import { missingKind } from "../src/desk/tile-kinds";
import { declaredKeys, hintKeys, traceActions } from "../src/surface/actions";
import { writeFileSync } from "node:fs";
import { forgetProjectionAnswers, projectionLayout, type ResourceProjection } from "../src/projection";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;:]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const EXAMPLES = ["moon", "horoscope", "fancy-horror", "tarot", "tidy"];

describe("a component's view in the terminal", () => {
  test("the shared primitives draw with their tone, a row sits side by side, a table fits, a link is tagged", () => {
    const view = { type: "card", title: "Plot 4", subtitle: "two beds still to dig", badge: { label: "busy", tone: "warn" }, children: [
      { type: "row", children: [{ type: "stat", label: "Beds", value: 6, unit: "of 8", tone: "good" }, { type: "sparkline", label: "Rain", values: [1, 3, 2, 5] }] },
      { type: "bar", label: "Dug", value: 6, max: 8 },
      { type: "checklist", items: [{ label: "dig the leek bed", done: true }, { label: "net the brassicas", done: false }] },
      { type: "table", columns: ["Bed", "Crop"], rows: [["1", "leeks"], ["2", "kale"]], links: ["aaaaaaaa-1111-4222-8333-444444444444", null] },
      { type: "box", title: "Note", children: [{ type: "text", text: "Water before noon.", strong: true }] },
    ] };
    const linked: string[] = [];
    const lines = primitiveLines(view, 60, (block, text) => { linked.push(block); return text; });
    const text = lines.map(plain);
    expect(text[0]).toBe("▌ Plot 4  [busy]");
    expect(text[1]).toBe("▌ two beds still to dig");
    expect(text[2]).toMatch(/^ {2}Beds {2}6 of 8 +Rain {2}▁▅▃█$/);
    expect(text[3]).toMatch(/^ {2}Dug {2}█+░+ {2}6\/8/);
    expect(text.slice(4, 6)).toEqual(["  [x] dig the leek bed", "  [ ] net the brassicas"]);
    expect(text.slice(6, 10).map(l => l.trimEnd())).toEqual(["  Bed  Crop", "  ───  ─────", "  1    leeks", "  2    kale"]);
    expect(linked).toEqual(["aaaaaaaa-1111-4222-8333-444444444444"]);
    expect(text.at(-3)).toMatch(/^ {2}┌─ Note ─+┐$/);
    expect(text.at(-2)).toMatch(/^ {2}│ Water before noon\. +│$/);
    expect(lines.join("")).toContain("\x1b[38;2;255;255;85m");                  // warn is yellow
    expect(() => primitiveLines({ type: "hologram" }, 40)).toThrow(/no primitive hologram/);
    // Text from an extension never reaches the terminal as an escape.
    expect(primitiveLines({ type: "text", text: "a\x1b[2Jb" }, 40).map(plain)).toEqual(["a [2Jb"]);
  });
});

describe.skipIf(!outliner)("the door draws what the service's terminal target draws", () => {
  test("every word of the service's terminal rendering of a view is in the door's, whatever the layout", async () => {
    const { renderComponent } = await import(join(outliner!, "src/component-primitives.ts"));
    const view = { type: "box", title: "Shed", children: [
      { type: "card", title: "Bikes", subtitle: "two need air", badge: { label: "soon", tone: "warn" }, children: [{ type: "text", text: "pump by the door\nspare tube on the hook" }] },
      { type: "row", children: [{ type: "stat", label: "Tubes", value: 3 }, { type: "badge", label: "ok" }] },
      { type: "bar", label: "Oil", value: 2, max: 5 },
      { type: "sparkline", label: "Rides", values: [1, 4, 2] },
      { type: "checklist", items: [{ label: "oil the chain", done: false }] },
      { type: "table", columns: ["Bike", "Tyre"], rows: [["red", "flat"], ["blue", 32]] },
    ] };
    const words = (t: string) => new Set(t.split(/[\s│┌┐└┘─▌\[\]]+/).filter(w => w && !/^[█░▁▂▃▄▅▆▇]+$/.test(w)));
    const theirs = words(renderComponent({ data: {}, view }, "terminal").body);
    const mine = words(primitiveLines(view, 100).map(plain).join("\n"));
    expect([...theirs].filter(w => !mine.has(w))).toEqual([]);
  });
});

describe.skipIf(!outliner)("parity with Detail's layout for an extension's line", () => {
  test("an output, a component, an agent's answer and a line not run yet read as Detail's", async () => {
    const theirs = await import(join(outliner!, "src/detail-embeds.ts"));
    const base = { anchor: { kind: "directive", line: 1, start: 0, end: 10 }, options: { unknown: [] }, fields: [] } as const;
    const cases: ResourceProjection[] = [
      { ...base, provider: "horoscope", label: "Horoscope", propertyKey: "horoscope", kind: "output", key: "virgo", status: "ready", summary: "Virgo", fetchedAt: "2026-10-01T09:00:00.000Z",
        output: { markdown: "**Virgo.** Plants have opinions.\n\n- Colour: slate\n", ranAt: "2026-10-01T09:00:00.000Z" } },
      { ...base, provider: "fancy-horror", label: "Fancy Horror", propertyKey: "fancy-horror", kind: "component", key: "virgo", status: "stale", reason: "the last run failed: timeout", summary: "Virgo", fetchedAt: "2026-10-01T09:00:00.000Z",
        output: { markdown: "**Virgo**\n\n- [ ] a door", ranAt: "2026-10-01T09:00:00.000Z", component: { data: {}, view: { type: "text", text: "x" } } } },
      { ...base, provider: "tidy", label: "Tidy", propertyKey: "@tidy", kind: "agent", key: "@tidy", status: "ready", summary: "tidied 1 line above", fetchedAt: "2026-10-01T09:00:00.000Z", agent: { name: "tidy", status: "applied" } },
      { ...base, provider: "tidy", label: "Tidy", propertyKey: "@tidy", kind: "agent", key: "@tidy", status: "not-run", reason: "r asks @tidy", agent: { name: "tidy", status: "not-asked" } },
      { ...base, provider: "moon", label: "Moon", propertyKey: "moon", kind: "data", key: "2026-10-26", status: "not-fetched", reason: "not fetched yet" },
    ];
    for (const p of cases) {
      const want = theirs.resourceProjectionLayout(p);
      expect({ kind: p.kind, lines: projectionLayout(p).lines }).toEqual({ kind: p.kind, lines: want.lines });
      expect({ kind: p.kind, fetchedLine: projectionLayout(p).fetchedLine }).toEqual({ kind: p.kind, fetchedLine: want.fetchedLine });
    }
  });
});

describe.skipIf(!outliner)("the four kinds in a door, against a scratch service", () => {
  const scratch = new Scratch();
  const extDir = join(scratch.workspace, "extensions");
  let board: SocketBoard, app: App, desk: Desk;
  let note: Msg;
  let keyIn: (k: Key) => void = () => {};
  const flashes: string[] = [];
  const surface = new NoteSurface();
  let host: SurfaceHost;
  const lines = () => surface.render(120, 80, host).lines.map(plain);
  const text = () => lines().join("\n");
  const AS = "ext-agent-512";
  const D = () => desk as any;
  const install = (id: string) => cpSync(join(outliner!, "extensions", id), join(extDir, id), { recursive: true });

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    mkdirSync(extDir, { recursive: true });
    for (const id of EXAMPLES) install(id);
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 160, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { keyIn = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    const flash = app.flash.bind(app);
    app.flash = (m: string, ms?: number) => { flashes.push(m); flash(m, ms); };
    app.push(new MainMenu());
    await app.loadExtensions(true);
    host = { ctx: app as any, redraw() {}, navigate() {} };
    note = await board.createBlock(null, "Omens for the week\nmoon:: 2026-10-26\nhoroscope:: virgo\nfancy-horror:: virgo\n\nwater   the  leeks\n@tidy");
    forgetProjectionAnswers();
    // @tidy answers once the note has been quiet a moment: the reader shows the note as it is then.
    const end = Date.now() + 15_000;
    while ((await board.get(note.id))!.revision === 1 && Date.now() < end) await Bun.sleep(100);
    surface.show((await board.get(note.id))!, host);
  }, 40_000);

  afterAll(async () => {
    D()?.dispose?.();
    board?.close();
    await scratch.dispose();
  });

  test("the service's list is bound: handler keys and agents are asked about, actions and the tile kind are registered", () => {
    expect(extensionList()?.extensions.map(e => e.id).sort()).toEqual([...EXAMPLES].sort());
    expect(mentionsExtension("Week\n- horoscope:: leo")).toBe(true);
    expect(mentionsExtension("Week\n@tidy please")).toBe(true);
    expect(mentionsExtension("Week\nhoroscopes:: leo\n@tidying")).toBe(false);
    expect(EXT_ACTIONS.has("ext.fancy-horror.ward")).toBe(true);
    expect(EXT_ACTIONS.has("ext.horoscope.keep")).toBe(true);
    expect(EXT_ACTIONS.has("ext.tarot.draw")).toBe(false);              // a tile's action is its kind's own
    expect(tileKind("tarot.reading")?.actions?.has("ext.tarot.draw")).toBe(true);
    expect(kindForKey("T")?.kind.kind).toBe("tarot.reading");
    expect(app.actions().actions.map(a => a.name)).toContain("ext.fancy-horror.ward");
  });

  test("a reader draws each kind under its line: a record, an output's markdown, a component's view, an agent's state", async () => {
    await until(() => text().includes("Moon on 2026-10-26: Full Moon") && text().includes("week of") && /Tidy @tidy · (applied|nothing)/.test(text()), "every line drawn", 20_000);
    const t = text();
    expect(t).toContain("phase: Full Moon · illumination: 100%");
    expect(t).toMatch(/∙ Horoscope virgo · ran (just now|\d+ min ago)/);
    expect(t).toMatch(/Virgo, \d{4}-\d\d-\d\d\. /);                         // the output's markdown, drawn
    expect(t).toContain("Colour: ");
    expect(t).toMatch(/▌ Virgo: week of \d{4}-\d\d-\d\d {2}\[uneasy\]/);    // the card, from its primitives
    expect(t).toMatch(/\[ \] (a door that closes by itself|the lift stops at a floor that isn't there)/);
    expect(t).toContain("[w ward] [keep] [r run again]");
    expect(t).toMatch(/Tidy @tidy · applied · tidied 1 line above/);
    expect(t).toContain("[r ask again]");
    // @tidy applied an attributed edit: the line above it is tidied, by ext:tidy.
    const after = (await board.get(note.id))!;
    expect(after.text).toContain("\nwater the leeks\n@tidy");
    const changes = await board.request<any>("changes.since", { sequence: 0, limit: 200 });
    expect(changes.changes.some((c: any) => c.blockId === note.id && c.actor?.actorId === "ext:tidy")).toBe(true);
  }, 30_000);

  test("[ ] reach the component's line and its controls; w wards it, a click on [keep] keeps it, both as ext:fancy-horror", async () => {
    let tries = 0;
    while (surface.describe().elements?.current?.label !== "Fancy Horror virgo" && tries++ < 30) { surface.key(char("]"), host); lines(); }
    expect(surface.describe().elements!.current).toMatchObject({ kind: "resource", label: "Fancy Horror virgo" });
    expect(surface.hint()).toStartWith(`[ ] `);
    expect(surface.hint()).toContain("w ward · r again · line Fancy Horror virgo · ⏎ ward off the next omen");
    // Every key the hint names is declared by an action the screen takes (the parity rule, PIE-506), and the
    // key runs the action that declares it.
    const declared = new Set(app.actions().actions.flatMap(a => [...declaredKeys(a.keys)]));
    const { NOTE_ACTIONS } = await import("../src/surface/note");
    for (const a of NOTE_ACTIONS.list()) for (const k of declaredKeys(a.keys)) declared.add(k);
    expect(hintKeys(surface.hint()).filter(k => !declared.has(k))).toEqual([]);
    const ran: string[] = [];
    const stop = traceActions(r => { if (r.keys && declaredKeys(r.keys).has("w")) ran.push(r.name); });
    surface.key(char("w"), host);
    stop();
    expect(ran).toEqual(["ext.fancy-horror.ward"]);
    await until(() => flashes.some(f => f.startsWith("Fancy Horror: Warded off")), "the ward", 15_000);
    expect(flashes.find(f => f.startsWith("Fancy Horror: Warded off"))).toContain("written as ext:fancy-horror");
    const kids = await board.children(note.id);
    const ward = kids.find(m => m.text.startsWith("Warded off "))!;
    expect(ward.author).toBe("ext:fancy-horror");
    // The line ran again and its view shows the warding.
    await until(() => /\[x\] /.test(text()), "the warded omen checked", 15_000);
    // A click on [keep]: its control is an element too, and the click runs it.
    const row = lines().findIndex(l => l.includes("[w ward] [keep]"));
    const col = lines()[row]!.indexOf("[keep]") + 1;
    surface.click(col + 1, row, host);
    await until(() => flashes.some(f => f.startsWith("Fancy Horror: kept fancy-horror:: as a block")), "keep", 15_000);
    expect((await board.children(note.id)).some(m => m.author === "ext:fancy-horror" && m.text.startsWith("Virgo"))).toBe(true);
  }, 40_000);

  test("an agent wards through act, attributed to the extension and said as the agent's; refusals say why", async () => {
    const before = (await board.children(note.id)).length;
    const r = await app.act({ action: "ext.fancy-horror.ward", args: { block: note.id }, as: AS }) as any;
    expect(r.extension).toBe("fancy-horror");
    expect(flashes.at(-1)).toStartWith(`an agent (${AS}) · Fancy Horror:`);
    expect((await board.children(note.id)).length).toBe(before + (r.written.length ? 1 : 0));
    await expect(app.act({ action: "ext.fancy-horror.ward", args: {}, as: AS })).rejects.toThrow(/say block=/);
    const other = await board.createBlock(null, "No omens here");
    await expect(app.act({ action: "ext.fancy-horror.ward", args: { block: other.id }, as: AS })).rejects.toThrow(/needs a fancy-horror:: line/);
  }, 30_000);

  test("r on the output's line runs that line again", async () => {
    let tries = 0;
    while (surface.describe().elements?.current?.label !== "Horoscope virgo" && tries++ < 30) { surface.key(char("["), host); lines(); }
    expect(surface.describe().elements!.current!.label).toBe("Horoscope virgo");
    flashes.length = 0;
    surface.key(char("r"), host);
    await until(() => flashes.some(f => f.includes("horoscope:: virgo ran")), "the run", 15_000);
  }, 30_000);

  test("tarot: a tile kind from the service opens by ^W o and act, keeps a reading as ext:tarot, saves its block and comes back", async () => {
    desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    desk.render(D().ctx);
    // ^W o T from the reader, which shows the note: the tile's block is that note.
    await D().act({ action: "open", args: { id: note.id } }, { kind: "user" }).catch(() => {});
    const reader = D().namedReaders()[0];
    D().focus = [...D().names].find(([, v]: any) => v === reader.name)![0];
    reader.pane.hold?.(note, desk);
    keyIn(ctrl("w")); keyIn(char("o")); keyIn(char("T"));
    const tiles = () => D().layoutGet().tiles as any[];
    await until(() => tiles().some(t => t.kind === "tarot.reading"), "the tarot tile");
    const tarot = tiles().find(t => t.kind === "tarot.reading");
    expect(tarot.args).toEqual({ block: note.id });
    desk.render(D().ctx);
    await until(() => tiles().find(t => t.kind === "tarot.reading")?.terminal?.running !== false, "its program");
    // Its actions are its kind's: an agent keeps the reading under the tile's block.
    const kept = await app.act({ action: "ext.tarot.keep", args: {}, reader: tarot.name, as: AS }) as any;
    expect(kept.tile).toBe(tarot.name);
    const reading = (await board.children(note.id)).find(m => m.author === "ext:tarot");
    expect(reading).toBeDefined();
    const drew = await app.act({ action: "ext.tarot.draw", args: {}, reader: tarot.name, as: AS }) as any;
    expect(drew.extension).toBe("tarot");
    // Opened by act too, on a block named by note=.
    await app.act({ action: "tile.open", args: { kind: "tarot.reading", note: note.id, name: "cards" }, as: AS });
    expect(tiles().find(t => t.name === "cards")).toMatchObject({ kind: "tarot.reading", args: { block: note.id } });
    // Saved with its kind and its block, nothing else.
    await D().act({ action: "layout.save", args: { name: "cards" } }, { kind: "user" });
    const saved = JSON.stringify(JSON.parse(readFileSync(join(process.env.EP0CH_STATE!, "layouts.json"), "utf8")).cards);
    expect(saved).toContain(`"kind":"tarot.reading"`);
    expect(saved).toContain(`"state":{"block":"${note.id}"}`);
    expect(saved).not.toContain("tile.ts");
    // A new door (a restart): the layout comes back before the list is read, its tiles say so, then run.
    bindExtensions(null);
    expect(tileKind("tarot.reading")).toBeUndefined();
    const again = new Desk(undefined, { layout: "cards" }) as any;
    const cards = () => again.layoutGet().tiles.find((t: any) => t.name === "cards");
    expect(cards()).toMatchObject({ kind: "tarot.reading", unregistered: "tarot.reading", title: "tarot.reading · unavailable" });
    // The running tile on the first desk keeps its program while the kind is away.
    expect(tiles().find(t => t.name === tarot.name).title).toContain("its kind is gone");
    await app.loadExtensions();
    expect(cards().unregistered).toBeUndefined();
    expect(cards()).toMatchObject({ kind: "tarot.reading", title: "Tarot", args: { block: note.id } });
    again.dispose();
    // Gone for good: a kind that comes later makes nothing there.
    expect(again.disposed).toBe(true);
  }, 40_000);

  test("hot reload: an extension removed while the door runs goes away (its tile says why), and comes back when added", async () => {
    rmSync(join(extDir, "tarot"), { recursive: true, force: true });
    rmSync(join(extDir, "horoscope"), { recursive: true, force: true });
    await until(() => !tileKind("tarot.reading") && !EXT_ACTIONS.has("ext.horoscope.keep"), "the extensions gone", 15_000);
    const tiles = () => D().layoutGet().tiles as any[];
    expect(tiles().find(t => t.name === "cards")).toMatchObject({ kind: "tarot.reading", unregistered: "tarot.reading" });
    expect(flashes.some(f => /extensions: .*removed/.test(f))).toBe(true);
    expect(mentionsExtension("x\nhoroscope:: leo")).toBe(false);
    install("tarot");
    await until(() => !!tileKind("tarot.reading"), "tarot back", 15_000);
    expect(tiles().find(t => t.name === "cards").unregistered).toBeUndefined();
  }, 40_000);

  test("an extension's words never reach the terminal as escapes: its action's message, its name, its output", async () => {
    const dir = join(extDir, "noisy");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "extension.json"), JSON.stringify({
      contract: 2, id: "noisy", version: 1, name: "Noisy\u001b[31m", run: ["bun", "noisy.ts"],
      handlers: [{ key: "noisy", kind: "output", effects: "read", argument: { name: "word" } }],
      actions: [{ id: "shout", label: "Shout\u001b[2J", on: "handler:noisy", key: "s", effects: "read" }],
    }));
    writeFileSync(join(dir, "noisy.ts"), `const r = await Bun.stdin.json();
process.stdout.write(JSON.stringify({ ok: true, value: r.operation === "act" ? { message: "loud\\u001b[2Jer" } : { markdown: "a \\u001b[2J b" } }));`);
    await until(() => EXT_ACTIONS.has("ext.noisy.shout"), "the noisy extension", 15_000);
    const loud = await board.createBlock(null, "A loud note\nnoisy:: hello");
    const r = await app.act({ action: "ext.noisy.shout", args: { block: loud.id }, as: AS }) as any;
    expect(r.message).toBe("loud [2Jer");
    expect(flashes.at(-1)).not.toContain("\x1b");
    expect(extensionList()!.extensions.find(e => e.id === "noisy")!.name).toBe("Noisy [31m");
    const s2 = new NoteSurface();
    s2.show((await board.get(loud.id))!, host);
    await until(() => s2.render(100, 30, host).lines.join("\n").includes("a [2J b") || s2.render(100, 30, host).lines.join("\n").includes("a  b"), "the output", 15_000);
    expect(s2.render(100, 30, host).lines.join("\n")).not.toContain("\x1b[2J");
    rmSync(dir, { recursive: true, force: true });
    await until(() => !EXT_ACTIONS.has("ext.noisy.shout"), "noisy gone", 15_000);
  }, 40_000);

  test("against a service without extensions.list: nothing is bound, and a tile of an extension's kind says why", async () => {
    const older = { listExtensions: async () => null } as any;
    const r = await loadExtensions(older);
    expect(r).toMatchObject({ unsupported: true, added: [], problems: [] });
    expect(EXT_ACTIONS.list()).toEqual([]);
    expect(mentionsExtension("x\nmoon:: 2026-10-26")).toBe(false);
    expect(missingKind("compost.heap")).toContain("lacks extensions.list");
    // A failed read keeps what was bound, and says so.
    await app.loadExtensions();
    expect(EXT_ACTIONS.has("ext.fancy-horror.ward")).toBe(true);
    const broken = { listExtensions: async () => { throw new Error("the service went away"); } } as any;
    expect(await loadExtensions(broken)).toEqual({ error: "the service went away" });
    expect(EXT_ACTIONS.has("ext.fancy-horror.ward")).toBe(true);
  }, 30_000);
});
