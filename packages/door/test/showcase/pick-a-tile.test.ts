// PIE-1298 / PIE-1297: the showcase's "Pick a tile" section. An empty-slot button asks for its value (the wire picker), the choice
// is written on its line as an address the tile grammar reads as identity, and a later press runs bound. One of the showcase's
// test files.
import { beforeAll, describe, expect, test } from "bun:test";
import { USER } from "../../src/socket";
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

  test("the person's press asks for a tile; the choice is written as the tile's id, and the next press lifts it, the one after drops it", async () => {
    const asked = await act("button.press", { label: "pop it" });
    expect(asked.picking).toBe("tile");
    await until(() => screen().includes("pop it: choose a tile for target"), "the picker's card");
    const links = (await act("tile.info", {}, "links")).tile as string;
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
    expect(lifted()).toBe(false);
    await act("button.press", { label: "pop it" });
    await until(lifted, "links lifted");
    expect(desk().lifted.reach).toBe("column");
    expect(desk().liftsPane(desk().pane("links"))).toBe(true);
    await act("button.press", { label: "pop it" });
    await until(() => !lifted(), "links dropped");
  });

  test("a slot never keeps a name or a number: an agent's value is resolved now and kept as the tile's id", async () => {
    const preview = (await act("tile.info", {}, "preview")).tile as string;
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
    const agent = (await act("tile.info", {}, "drawer.agent")).tile as string;
    expect((await act("button.press", { note, label: "pop it" })).picking).toBe("tile");
    await act("tile.pick", { to: "drawer.agent" });
    // The drawer's program fills a place (role:agent, written drawer.agent): the card asks, 1 keeps this tile exactly.
    await until(() => screen().includes("whichever fills its place · drawer.agent"), "the exact-or-place card");
    // The card's "1 · this tile" row (the showcase keeps 1-9 for its sections until you step into the stage).
    await act("tile.pick", { value: agent });
    await untilAsync(() => buttonLine().then(l => l === probe.replace("target=}", `target=${agent}}`)), "the program's id on the line");
    await act("button.press", { note, label: "pop it" });
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
    const links = (await act("tile.info", {}, "links")).tile as string;
    await act("tile.pick", { to: "links" });
    if (!(await line()).includes(links)) await act("tile.pick", { value: links });
    await untilAsync(() => line().then(l => l === probe.replace("target=}", `target=${links}}`)), "the id on the status-bar note's line");
    await act("host.toggle", { open: false });
  });

  // PIE-1297: copy a tile's and a note's id and reference from where you see them.
  test("the tile menu heads with the tile's id and has copy id and copy reference, beside the note's own", async () => {
    const links = (await act("tile.info", {}, "links")).tile as string;
    const menu = await act("tile.menu", {}, "notes", AGENT);
    const rows = (menu.rows as { label: string; group: string; action: string }[]).map(r => `${r.group}: ${r.label}`);
    expect(rows).toEqual(expect.arrayContaining(["Tile: copy id", "Tile: copy reference", "Note: copy id", "Note: copy reference"]));
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

});
