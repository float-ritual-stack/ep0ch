// PIE-1298 / PIE-1297: the showcase's "Pick a tile" section. An empty-slot button asks for its value (the wire picker), the choice
// is written on its line as an address the tile grammar reads as identity, and a later press runs bound. One of the showcase's
// test files.
import { beforeAll, describe, expect, test } from "bun:test";
import { USER } from "../../src/socket";
import { subject } from "../../src/board";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};
const AGENT = { kind: "agent", id: "pick-tester" } as never;

describe.skipIf(!outliner)("the showcase screen: pick a tile", () => {
  const h = useShowcaseScreen();
  const { screen } = h;
  let board!: typeof h.board, app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(async () => {
    ({ board, app, seeded } = h);
    await app.dispatch.act({ action: "section", args: { name: "pick-a-tile" } }, USER);
    await until(() => screen().includes("[pop it]"), "the button");
  });
  const text = async () => (await board.get(seeded.notes.pickATile.id))!.text;
  const buttonLine = async () => (await text()).split("\n").find(l => l.includes('label="pop it"'))!;
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string, who = USER as never) => app.dispatch.act({ action, args, ...(tile ? { tile } : {}) }, who) as Promise<any>;
  /** The section's desk: what is lifted on it (tile.zoom reach=column). */
  const desk = () => h.S().stages.get(h.S().sel).top;
  const lifted = () => !!desk().lifted;

  test("an agent's press of an empty slot never opens the person's picker: it is told the line to run", async () => {
    await expect(act("button.press", { label: "pop it" }, undefined, AGENT)).rejects.toThrow(/button\.slot .*key=target value=/);
    expect(screen()).not.toContain("choose a tile for target");
    // Nor can it answer the person's picker: a pick's answer runs as the person.
    await expect(act("tile.pick", { then: `button.slot note=${seeded.notes.pickATile.id} line=3 key=target`, value: "links" }, undefined, AGENT)).rejects.toThrow();
    expect(await buttonLine()).toContain("target=}");
  });

  test("the person's press asks for a tile; the choice is written as the tile's id and the press runs: it lifts, the next press drops it", async () => {
    const asked = await act("button.press", { label: "pop it" });
    expect(asked.picking).toBe("tile");
    await until(() => screen().includes("pop it: choose a tile for target"), "the picker's card");
    // A tile's frame says what a click does here: it chooses, it doesn't wire.
    expect(screen()).toContain("click to choose");
    expect(screen()).not.toContain("click to link here");
    const links = (await act("tile.info", {}, "links", AGENT)).tile as string;
    expect(links).toMatch(/^t-[0-9a-f-]{36}$/);
    // The card's rows choose by number; `to` is the same choice through act. The links tile fills a slot of this screen, so the
    // card asks: this tile exactly, or whichever fills its place.
    const chose = await act("tile.pick", { to: "links" });
    if (chose.picking === "which") {
      await until(() => screen().includes("this tile exactly"), "the exact-or-place question");
      await act("tile.pick", { value: links });
    }
    await untilAsync(() => buttonLine().then(l => l.includes(`target=${links}`)), "the id written on the line", 10_000);
    expect(await buttonLine()).toBe(`::button{label="pop it" act="tile.zoom tile={target} reach=column" target=${links}}`);
    // The pick finishes the press that asked for it (PIE-1392): no second press to run it.
    await until(lifted, "links lifted");
    expect(desk().lifted.reach).toBe("column");
    expect(desk().liftsPane(desk().pane("links"))).toBe(true);
    await act("button.press", { label: "pop it" });
    await until(() => !lifted(), "links dropped");
  });

  test("a slot never keeps a name or a number: an agent's value is resolved now and kept as the tile's id", async () => {
    const preview = (await act("tile.info", {}, "preview", AGENT)).tile as string;
    await act("button.slot", { label: "pop it", key: "target", value: "preview" }, undefined, AGENT);
    expect(await buttonLine()).toContain(`target=${preview}`);
    // A role is identity: kept as written.
    await expect(act("button.slot", { label: "pop it", key: "target", value: "t-00000000" }, undefined, AGENT)).rejects.toThrow(/not kept: .*t-00000000/);
    expect(await buttonLine()).toContain(`target=${preview}`);
  });

  test("a target that resolves to nothing refuses the press and never acts on the focused tile", async () => {
    const note = seeded.notes.pickATile.id, before = await text();
    const gone = before.replace(/target=t-[0-9a-f-]+/, "target=t-0123abcd-0000-0000-0000-000000000000");
    const m = (await board.get(note))!;
    await board.update(note, gone, m.revision!);
    await untilAsync(() => text().then(t => t === gone), "the dead target saved");
    await expect(act("button.press", { note, label: "pop it" }, undefined, AGENT)).rejects.toThrow(/no tile has the id t-0123abcd/);
    // The person's press says so on the status line and lifts nothing.
    await act("button.press", { note, label: "pop it" });
    await Bun.sleep(100);
    expect(lifted()).toBe(false);
  });

  test("the misread button runs nothing and says the line to write", async () => {
    await expect(act("button.press", { note: seeded.notes.pickATile.id, label: "misread" }, undefined, AGENT)).rejects.toThrow(/act= ends early.*act='tile\.zoom reach=column tile=t-a6125371'/);
  });

  // PIE-1312: a ::button line typed in the editor is drawn in parts, what won't run is underlined, and the row under the cursor
  // says what it runs or why not, by the same reader as the save's warning. Typed as a person types.
  test("typing a button: a wrong one is marked as it is typed, fixed, saved, and nothing is lost", async () => {
    const { press, ch } = h;
    await act("section", { name: "pick-a-tile" });
    press({ kind: "enter" });
    await until(() => h.S().focus === "stage", "in the stage");
    await act("tile.focus", {}, "notes");
    ch("e"); press({ kind: "enter" });
    await until(() => !!desk().describe().panes[0].editing, "the note in an edit");
    for (let i = 0; i < 8; i++) press({ kind: "pgdn" });
    press({ kind: "end" }); press({ kind: "enter" });
    for (const c of '::button{label="two" act="tile.zom reach="column" tile=links}') ch(c);
    await until(() => screen().includes("✗ act= ends early"), "the misread said under the line");
    // Underlined (SGR 4) where the line stops being read.
    expect(h.painted.join("\n")).toContain("\x1b[4m");
    // Fix it: the nested quotes go, and the action's name.
    for (let i = 0; i < '"column" tile=links}'.length; i++) press({ kind: "backspace" });
    for (const c of 'column tile=links"}') ch(c);
    await until(() => screen().includes("✗ no action tile.zom here; did you mean tile.zoom?"), "the unknown action said");
    for (let i = 0; i < 'm reach=column tile=links"}'.length; i++) press({ kind: "left" });
    ch("o");
    // The name's completion opens under the line; esc puts it away and the help row is under the line again.
    press({ kind: "esc" });
    expect(desk().describe().panes[0].editing).toBeTruthy();
    await until(() => screen().includes("▸ runs tile.zoom reach=column tile=links"), "what it runs");
    press({ kind: "char", ch: "s", ctrl: true });
    await untilAsync(() => text().then(t => t.includes('::button{label="two" act="tile.zoom reach=column tile=links"}')), "saved as typed");
    for (let i = 0; i < 4 && h.S().focus === "stage"; i++) press({ kind: "esc" });
  });

  // Evan's probe, pie's "pop it" note, second line unmodified: press it in a reader, click the drawer's program, the line gets its
  // id, and the program lifts; press again, it drops.
  test("the probe: an empty target, the drawer's program chosen on the card, kept as its id; it lifts and drops", async () => {
    const note = seeded.notes.pickATile.id, probe = '::button{label="pop it" act="tile.zoom tile={target} reach=column" target=}';
    const m = (await board.get(note))!;
    await board.update(note, m.text.replace(/^::button\{label="pop it".*$/m, probe), m.revision!);
    await untilAsync(() => buttonLine().then(l => l === probe), "the probe written as Evan wrote it");
    const drawer = (app as any).drawer;
    // The drawer's own program (the test door's is EP0CH_DAILY_AGENT's shell): pulling the drawer up starts it.
    await act("host.toggle", { open: true });
    await until(() => !!drawer.tile, "the drawer's program running");
    const agent = (await act("tile.info", {}, "drawer.agent", AGENT)).tile as string;
    expect((await act("button.press", { note, label: "pop it" })).picking).toBe("tile");
    await act("tile.pick", { to: "drawer.agent" });
    // The drawer's program fills a place (role:agent, written drawer.agent): the card asks, 1 keeps this tile exactly.
    await until(() => screen().includes("whichever fills its place · drawer.agent"), "the exact-or-place card");
    // The card's "1 · this tile" row (the showcase keeps 1-9 for its sections until you step into the stage).
    await act("tile.pick", { value: agent });
    await untilAsync(() => buttonLine().then(l => l === probe.replace("target=}", `target=${agent}}`)), "the program's id on the line");
    // The pick runs the press it answered.
    await until(() => !!drawer.made?.lifted, "the drawer's program lifted");
    expect(drawer.made.liftsPane(drawer.tile)).toBe(true);
    await act("button.press", { note, label: "pop it" });
    await until(() => !drawer.made.lifted, "dropped");
  });

  // Evan's probe lives in his status bar: pressed there, the pick's answer is written by the door's own button.slot, whichever
  // tile has the keys (here the drawer's shell, after the drawer came up to pick from).
  test("the probe on the status bar: pressed with the keys in the drawer's shell, the pick is written on the status-bar note", async () => {
    const bar = seeded.notes.statusBar.id, probe = '::button{label="pop it" act="tile.zoom tile={target} reach=column" target=}';
    const m = (await board.get(bar))!;
    await board.update(bar, m.text.replace(/^::button\{label="pop it".*$/m, probe), m.revision!);
    const line = async () => (await board.get(bar))!.text.split("\n").findLast(l => l.includes("tile={target}"))!;
    await untilAsync(() => line().then(l => l === probe), "the probe on the status-bar note");
    await act("host.toggle", { open: true });
    await act("tile.focus", {}, "drawer.agent");
    expect((await act("button.press", { note: bar, label: "pop it" })).picking).toBe("tile");
    const links = (await act("tile.info", {}, "links", AGENT)).tile as string;
    await act("tile.pick", { to: "links" });
    if (!(await line()).includes(links)) await act("tile.pick", { value: links });
    await untilAsync(() => line().then(l => l === probe.replace("target=}", `target=${links}}`)), "the id on the status-bar note's line");
    // The pick ran the press: drop what it lifted.
    await until(() => lifted(), "links lifted by the press the pick finished");
    await act("button.press", { note: bar, label: "pop it" });
    await until(() => !lifted(), "links dropped");
    await act("host.toggle", { open: false });
  });

  // PIE-1297: copy a tile's and a note's id and reference from where you see them.
  test("the tile menu heads with the tile's id and starts with its Copy group: the note's copy rows and the tile's own", async () => {
    const links = (await act("tile.info", {}, "links", AGENT)).tile as string;
    const menu = await act("tile.menu", {}, "notes", AGENT);
    const rows = (menu.rows as { label: string; group: string; action: string }[]).map(r => `${r.group}: ${r.label}`);
    expect(rows).toEqual(expect.arrayContaining(["Copy: copy tile id", "Copy: copy tile reference", "Copy: copy note id", "Copy: copy note reference"]));
    expect(rows[0]).toBe("Copy: copy note id");
    // An agent's copy comes back to it; the person's clipboard is untouched.
    expect(await act("tile.copy-ref", { kind: "id" }, "links", AGENT)).toMatchObject({ text: links, clipboard: false });
    const ref = await act("tile.copy-ref", { kind: "ref" }, "drawer.agent", AGENT);
    expect(ref).toMatchObject({ text: "drawer.agent", place: "drawer.agent", clipboard: false });
    const note = seeded.notes.pickATile.id;
    expect(await act("note.copy-ref", { kind: "ref" }, "notes", AGENT)).toMatchObject({ text: `((${note}|Pick a tile instead of typing its id))`, clipboard: false });
    // The person's goes to their clipboard (OSC 52) and the status line says what.
    const before = h.written.length;
    expect(await act("note.copy-ref", { kind: "id" }, "notes")).toMatchObject({ text: note, clipboard: true });
    expect(h.written.slice(before).join("")).toContain(Buffer.from(note).toString("base64"));
    // The person's menu, opened, is headed with the tile's name and its short id.
    await act("tile.menu", {}, "links");
    await until(() => screen().includes(`links · ${links.slice(0, 10)}`), "the menu's heading");
    h.press({ kind: "esc" } as never);
  });

  // PIE-1297, the note half: the web link, a line's reference, and the same copy on every row that is a note.
  test("note.copy-ref in a reader: its web link, and a line's reference that mints the line's anchor once", async () => {
    const note = seeded.notes.pickATile.id;
    // Named by its outline: the web client's root outline's /pub/o/<name>/ redirects to /pub/p/.
    const link = await act("note.copy-ref", { kind: "link" }, "notes", AGENT);
    expect(link).toMatchObject({ clipboard: false });
    expect(link.text).toMatch(new RegExp(`^https://[^/]+/pub/o/[^/]+/p/${note}$`));
    // An agent names the line; it never reads the person's cursor.
    await expect(act("note.copy-ref", { kind: "line" }, "notes", AGENT)).rejects.toThrow(/line=/);
    const line = (await text()).split("\n").findIndex(l => l.startsWith("Press pop it")) + 1;
    // A line's reference is placed in the text the reader read, so a copy from a reader behind the service is refused ("read
    // again, copy once more"): an earlier test's write reaches the reader with its event, after the service has it on a loaded box.
    const current = () => untilAsync(async () => (desk().pane("notes") as any)?.msg?.revision === (await board.get(note))!.revision, "the reader on the note as the service has it");
    await current();
    const first = await act("note.copy-ref", { kind: "line", line }, "notes", AGENT);
    expect(first).toMatchObject({ line, created: true, clipboard: false });
    expect(first.text).toBe(`((${note}^${first.anchor}|${first.text.slice(first.text.indexOf("|") + 1, -2)}))`);
    await untilAsync(() => text().then(t => t.includes(`^${first.anchor}`)), "the anchor in the note");
    // Again, once the reader has the anchor's write: the same anchor, nothing written.
    await current();
    expect(await act("note.copy-ref", { kind: "line", line }, "notes", AGENT)).toMatchObject({ anchor: first.anchor, created: false });
    // The person's, with nothing selected, names the part being read (the title at the top takes no anchor: the first part from there).
    const read = await act("note.copy-ref", { kind: "line" }, "notes");
    expect(read).toMatchObject({ clipboard: true });
    expect(read.text).toMatch(new RegExp(`^\\(\\(${note}\\^[A-Za-z0-9_-]+\\|.+\\)\\)$`));
    // The person's ^W y copies the reference of the note in the tile with the keys.
    const { press, ch } = h;
    await act("section", { name: "pick-a-tile" });
    press({ kind: "enter" });
    await until(() => h.S().focus === "stage", "in the stage");
    await act("tile.focus", {}, "notes");
    // What an earlier test left open over the desk (the menu it opened) goes first.
    for (let i = 0; i < 4 && (desk() as any).overlays.top(); i++) press({ kind: "esc" });
    const before = h.written.length;
    press({ kind: "char", ch: "w", ctrl: true } as never); ch("y");
    await until(() => h.written.slice(before).join("").includes(Buffer.from(`((${note}|`).toString("base64").slice(0, 40)), "the reference on the clipboard");
    for (let i = 0; i < 4 && h.S().focus === "stage"; i++) press({ kind: "esc" });
  });

  test("tile.info as the person shows a card by the tile, with its id and copy rows", async () => {
    const links = (await act("tile.info", {}, "links", AGENT)).tile as string;
    // A read (a button's tile= resolved, an agent's ask) shows nothing; the person's card=true (^W ,) shows the card.
    await act("tile.info", {}, "links");
    expect(screen()).not.toContain(`tile: ${links}`);
    await act("tile.info", { card: true }, "links");
    await until(() => screen().includes(`tile: ${links}`), "the tile's card");
    expect(screen()).toContain("copy tile reference");
    await act("hint.dismiss", {}, "links");
  });

  test("every row that is a note copies it through the row's own menu: the tree's selected row, by act and by a click", async () => {
    await act("section", { name: "panes" });
    await until(() => (h.S().stages.get(h.S().sel)?.top?.layoutGet?.().tiles ?? []).some((t: any) => t.kind === "tree"), "the panes section's tree");
    const d = desk(), tree = d.layoutGet().tiles.find((t: any) => t.kind === "tree")!.name;
    await until(() => (d.pane(tree) as any).list().length > 1, "the tree's rows");
    // The person's selection, on a row that is a note.
    for (let n = 1; !d.pane(tree).subject?.() && n < 8; n++) await act("tree.pick", { n }, tree);
    // The pick opens its note, and the tree reveals the note it opened: wait for the selection to settle.
    await until(() => !!d.pane(tree).subject?.() && d.pane(tree).subject!() === (d as any).current?.id, "the pick shown and the tree's selection on it");
    const notebook = d.pane(tree).subject!()!;
    const title = subject((await board.get(notebook))!);
    expect(await act("note.copy-ref", { kind: "ref" }, tree, AGENT)).toMatchObject({ id: notebook, text: `((${notebook}|${title}))`, clipboard: false });
    expect(await act("note.copy-ref", { kind: "id" }, tree, AGENT)).toMatchObject({ text: notebook });
    const web = (await act("note.copy-ref", { kind: "link" }, tree, AGENT)).text as string;
    expect(web).toEndWith(`/p/${notebook}`);
    // A line is a reader's: a list row has none.
    await expect(act("note.copy-ref", { kind: "line" }, tree, AGENT)).rejects.toThrow(/reader/);
    const rows = ((await act("tile.menu", {}, tree, AGENT)).rows as { label: string; group: string }[]).map(r => `${r.group}: ${r.label}`);
    // The Copy group first (PIE-1398), the note's rows and the tile's, each saying which it copies.
    expect(rows.slice(0, 5)).toEqual(["Copy: copy note id", "Copy: copy note reference", "Copy: copy note web link", "Copy: copy tile id", "Copy: copy tile reference"]);
    expect(rows).not.toContain("Copy: copy line reference");
    // The person's menu, opened on the row's tile; a click on its "copy note web link" row puts the link on the clipboard.
    await act("tile.menu", { q: "copy note web link" }, tree);
    await until(() => screen().includes("copy note web link"), "the menu");
    const lines = h.sc.render(h.app).lines.map((l: string) => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, ""));
    // The last match is the row: the first is the menu's query line, typed.
    const y = lines.findLastIndex((l: string) => l.includes("copy note web link")), x = lines[y]!.lastIndexOf("copy note web link") + 2;
    const before = h.written.length;
    h.press({ kind: "mouse", action: "down", button: 0, x, y } as never);
    h.press({ kind: "mouse", action: "up", button: 0, x, y } as never);
    await until(() => h.written.slice(before).join("").includes(Buffer.from(web).toString("base64")), "the web link on the clipboard");
    // A right-click on another row is that row's menu: the row is picked first, and its Note rows copy it.
    const plainLines = () => h.sc.render(h.app).lines.map((l: string) => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, ""));
    await until(() => plainLines().some((l: string) => l.includes("Bean packet")), "the Bean packet row");
    const bean = plainLines(), by = bean.findIndex((l: string) => l.includes("Bean packet")), bx = bean[by]!.indexOf("Bean packet") + 2;
    expect(subject((await board.get(d.pane(tree).subject!()!))!)).not.toBe("Bean packet");
    h.press({ kind: "mouse", action: "down", button: 2, x: bx, y: by } as never);
    h.press({ kind: "mouse", action: "up", button: 2, x: bx, y: by } as never);
    await until(() => plainLines().some((l: string) => l.includes("copy note web link")), "the row's menu");
    const picked = d.pane(tree).subject!()!;
    expect(subject((await board.get(picked))!)).toBe("Bean packet");
    // Its "copy note id", first under the Copy heading.
    const menu = plainLines(), nh = menu.findIndex((l: string) => /│ Copy ─/.test(l)), my = menu.findIndex((l: string, i: number) => i > nh && /│\s*copy note id\s/.test(l)), mx = menu[my]!.lastIndexOf("copy note id") + 2;
    const at = h.written.length;
    h.press({ kind: "mouse", action: "down", button: 0, x: mx, y: my } as never);
    h.press({ kind: "mouse", action: "up", button: 0, x: mx, y: my } as never);
    await until(() => h.written.slice(at).join("").includes(Buffer.from(picked).toString("base64")), "the row's id on the clipboard");
  }, 30_000);

  test("a card of a mounted board: a right-click on it is its lane's menu, and copies that card", async () => {
    await act("section", { name: "screen" });
    const plainLines = () => h.sc.render(h.app).lines.map((l: string) => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, ""));
    await until(() => plainLines().some((l: string) => l.includes("Fix the back gate")), "the mounted board's card");
    const at = plainLines(), y = at.findIndex((l: string) => l.includes("Fix the back gate")), x = at[y]!.indexOf("Fix the back gate") + 2;
    h.press({ kind: "mouse", action: "down", button: 2, x, y } as never);
    h.press({ kind: "mouse", action: "up", button: 2, x, y } as never);
    // The lane's own menu (not the mount's), its Note rows the card's.
    await until(() => plainLines().some((l: string) => /Queued · t-/.test(l)), "the lane's menu");
    // Typed, the menu narrows to the card's Note row: ⏎ copies the card's reference.
    const before = h.written.length;
    for (const c of "copy note web link") h.ch(c);
    h.press({ kind: "enter" });
    await until(() => /\/p\/HOME-001/.test(Buffer.from((h.written.slice(before).join("").match(/\x1b\]52;c;([A-Za-z0-9+/=]+)/)?.[1]) ?? "", "base64").toString()), "the card's web link, by its Work ID");
    h.press({ kind: "esc" });
  }, 30_000);

  // Last, as neat rearranges the section's tiles. The validate sweep's repro (Oct 28): two empty slots of an of= script asked
  // page2 first, as free text. Now page 1 of 2 comes first, from the notes (neat declares [form-field::page note]), each pick is written as the note's id, and the press runs.
  test("a script's empty slots ask in order, in the kind the script declares; the last pick puts the pages side by side", async () => {
    const note = seeded.notes.pickATile.id;
    const two = async () => (await text()).split("\n").find(l => l.includes('label="two up"'))!;
    // An agent is told the kind it gives.
    await expect(act("button.press", { note, label: "two up" }, undefined, AGENT)).rejects.toThrow(/key=page1 value=<note>/);
    const asking = () => (app as any).bar?.describe() as { scope: string; query: string; rows: { label: string; detail?: string }[] } & Record<string, unknown> | undefined;
    expect(await act("button.press", { note, label: "two up" })).toMatchObject({ asking: "value", action: "two up: page1 (1 of 2)" });
    await until(() => asking()?.scope === "ask", "page 1 of 2 asked first, in the power bar");
    // The kind's rows are notes the search found (each previews its note); a click or its number picks one.
    const found = (title: string) => asking()?.rows.find(r => r.label.includes(title) && r.detail === "found") as { n: number } | undefined;
    const pick = async (title: string) => {
      for (const c of title) h.ch(c);
      await until(() => !!found(title), `${title} among the notes`);
      await app.dispatch.press("bar.pick", { n: found(title)!.n });
    };
    await pick("Bike shed");
    await untilAsync(() => two().then(l => l.includes(`page1=${seeded.notes.shed.id}`)), "page1 written as the note's id");
    await until(() => asking()?.scope === "ask", "then page 2 of 2");
    await pick("A neat workbench");
    await untilAsync(() => two().then(l => l.includes(`page2=${seeded.notes.neat.id}`)), "page2 written");
    expect(await two()).toBe(`::button{label="two up" of="neat" page={page1} page={page2} page1=${seeded.notes.shed.id} page2=${seeded.notes.neat.id}}`);
    // The last pick finishes the press (PIE-1392): neat runs with no second press.
    await until(() => app.describe().messages.some(row => /(^|· )neat:/.test(row.message)), "neat ran", 10_000);
    const main = (await act("layout.get")).layers.find((l: any) => !l.drawer).tiles as any[];
    const a = main.find(t => t.showing?.id === seeded.notes.shed.id), b = main.find(t => t.showing?.id === seeded.notes.neat.id);
    expect(a && b).toBeTruthy();
    expect(a.rect.row).toBe(b.rect.row);
    expect(a.rect.col).toBeLessThan(b.rect.col);
  }, 30_000);
});
