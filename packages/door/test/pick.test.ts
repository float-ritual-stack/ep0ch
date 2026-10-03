// Insert from a picker (src/pick.ts): ctrl+t in a draft hands the terminal to a picker program and puts what it
// printed at the cursor. Here the picker is a shell line that prints (no tv): the real handover path, the output
// file, the environment it's given, and what goes in. No service: the reader's host is a stand-in.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Draft } from "../src/edit";
import { atCursor, channelOf, pickedText, pickerOf, pickerRun, pickInto, pickRunner } from "../src/pick";
import { USER } from "../src/socket";
import { editorClick, renderEditor } from "../src/surface/editor";
import { NOTE_ACTIONS, NoteSurface, type SurfaceHost } from "../src/surface/note";
import { Dispatcher } from "../src/surface/dispatch";
import { BOARD_ACTIONS } from "../src/desk/lanes";
import { runProgram, type Handover } from "../src/term";
import type { Msg } from "../src/board";

const OUTLINE = { socket: "/tmp/fictional/outlines/.host/host.sock", name: "garden" };
/** The door stepping aside: the program runs with this process's stdio, as `ctx.suspend` hands the terminal over. */
const stepAside = (log: string[] = []) => ({
  async suspend(run: (t: Handover) => Promise<unknown>, what?: string) { log.push(what ?? ""); await run({ run: (argv, o) => runProgram(argv, o) }); },
});
async function withEnv<T>(vars: Record<string, string | undefined>, f: () => Promise<T>): Promise<T> {
  const was = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const draft = (text: string, col: number) => { const d = new Draft("n1", 1, text); d.place(0, col); return d; };

describe("what a picker printed, as it goes in", () => {
  test("one choice per line, joined by spaces; blank lines dropped", () => {
    expect(pickedText("((a1))\n((b2))\n\n")).toBe("((a1)) ((b2))");
    expect(pickedText("[file::/srv/plot/beds.md]\r\n")).toBe("[file::/srv/plot/beds.md]");
    expect(pickedText("\n")).toBe("");
  });

  test("a space before it when it would run into a word; none after a space or at a line's start", () => {
    expect(atCursor(draft("see", 3), "((a1))")).toBe(" ((a1))");
    expect(atCursor(draft("see ", 4), "((a1))")).toBe("((a1))");
    expect(atCursor(draft("", 0), "((a1))")).toBe("((a1))");
  });

  test("the picker and its channel: tv and ep0ch unless configured; an empty channel is none", () => {
    expect([pickerOf({}), channelOf({})]).toEqual(["tv", "ep0ch"]);
    expect([pickerOf({ EP0CH_PICKER: "fzf -m" }), channelOf({ EP0CH_PICK_CHANNEL: "" })]).toEqual(["fzf -m", ""]);
  });

  test("its environment: the drop shell's, with the draft's outline named outright", () => {
    const r = pickerRun("ep0ch", "/tmp/out.txt", OUTLINE, { PATH: "/usr/bin", EP0CH_MACHINE: "box-a", EP0CH_WS: "other", EP0CH_LANDING: "brief" }, "/tmp/door/door.sock");
    expect(r.env).toMatchObject({ EP0CH_SOCKET: OUTLINE.socket, EP0CH_WS: "garden", EP0CH_CONTROL: "/tmp/door/door.sock", EP0CH_IN_DOOR: "1", EP0CH_PICK_OUT: "/tmp/out.txt", PATH: "/usr/bin" });
    expect("EP0CH_MACHINE" in r.env || "EP0CH_LANDING" in r.env).toBe(false);
    expect(r.argv.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(r.argv.at(-1)).toBe("ep0ch");
    // What the door sets over a terminal tile's own environment: the same outline, the machine unset.
    expect(r.own).toEqual({ EP0CH_SOCKET: OUTLINE.socket, EP0CH_WS: "garden", EP0CH_MACHINE: null, EP0CH_PICK_OUT: "/tmp/out.txt" });
  });
});

describe("pickInto: the terminal handed over, the choice put in", () => {
  test("what the picker prints goes in at the cursor, as the person's typing", async () => {
    const d = draft("Ask about the shed", 9), log: string[] = [];
    const r = await withEnv({ EP0CH_PICKER: "printf '((a1))\\n((b2))\\n'" }, () => pickInto(stepAside(log), d, OUTLINE));
    expect(r).toEqual({ inserted: " ((a1)) ((b2))" });
    expect(d.text).toBe("Ask about ((a1)) ((b2)) the shed");
    expect(d.dirty).toBe(true);
    expect(log).toEqual(["picker"]);
  });

  test("the channel is the picker's argument, and the picker sees the draft's outline", async () => {
    const d = draft("", 0);
    await withEnv({ EP0CH_PICKER: `sh -c 'echo "$EP0CH_WS:$1"' sh` }, () => pickInto(stepAside(), d, OUTLINE, { channel: "ep0ch-files" }));
    expect(d.text).toBe("garden:ep0ch-files");
  });

  test("nothing chosen, or a picker that isn't there: nothing goes in, and the draft says so", async () => {
    const d = draft("as it was", 2);
    expect(await withEnv({ EP0CH_PICKER: "true" }, () => pickInto(stepAside(), d, OUTLINE))).toEqual({ nothing: "nothing chosen in true ep0ch" });
    // tv exits 1 for esc and for a channel it doesn't have (the extension not installed): both said.
    expect(await withEnv({ EP0CH_PICKER: "false" }, () => pickInto(stepAside(), d, OUTLINE))).toEqual({ nothing: expect.stringContaining('or it has no "ep0ch" channel') });
    const gone = await withEnv({ EP0CH_PICKER: "no-such-picker-here 2>/dev/null" }, () => pickInto(stepAside(), d, OUTLINE));
    expect(gone).toEqual({ nothing: expect.stringContaining("exited 127: not found") });
    expect([d.text, d.dirty]).toEqual(["as it was", false]);
  });

  test("a draft that closed while the picker was open gets nothing; the choice is handed back to be said", async () => {
    const d = draft("closed", 6);
    const r = await withEnv({ EP0CH_PICKER: "echo" }, () => pickInto(stepAside(), d, OUTLINE, { channel: "((a1))", held: () => false }));
    expect(r).toEqual({ kept: "((a1))", at: expect.stringContaining("picked-"), why: "the draft closed while echo ((a1)) was open" });
    expect(readFileSync((r as { at: string }).at, "utf8")).toBe("((a1))\n");
    expect(d.text).toBe("closed");
  });
});

describe("pickInto on a screen with tiles: the picker beside the note", () => {
  /** A screen's `inTile`: the program runs (here as a plain child, its stdout to the file as sh sends it) and `done` hears its code. */
  const tiles = (seen: { name?: string; shows?: string; env?: Record<string, string | null> }[], log: string[] = []) => ({
    ...stepAside(log),
    inTile(p: { cmd: string[]; name: string; shows?: string; env?: Record<string, string | null> }, done: (code: number | null) => void) {
      seen.push({ name: p.name, shows: p.shows, env: p.env });
      const env: Record<string, string> = { ...process.env } as Record<string, string>;
      for (const [k, v] of Object.entries(p.env ?? {})) { if (v === null) delete env[k]; else env[k] = v; }
      void runProgram(p.cmd, { env }).then(done);
      return true;
    },
  });

  test("it runs in a tile, not the person's terminal; the choice goes in when it exits, and a second ctrl+t meanwhile opens nothing", async () => {
    const d = draft("Ask about the shed", 9), seen: { name?: string; shows?: string; env?: Record<string, string | null> }[] = [], log: string[] = [];
    const r = await withEnv({ EP0CH_PICKER: `sh -c 'sleep 0.2; echo "(($EP0CH_WS-$1))"' sh` }, async () => {
      const first = pickInto(tiles(seen, log), d, OUTLINE, { channel: "c1" });
      expect(d.note).toContain("beside");
      expect(await pickInto(tiles(seen, log), d, OUTLINE)).toEqual({ nothing: expect.stringContaining("already open beside") });
      return await first;
    });
    expect(r).toEqual({ inserted: " ((garden-c1))" });
    expect(d.text).toBe("Ask about ((garden-c1)) the shed");
    expect(log).toEqual([]);                                          // the terminal was never handed over
    expect(seen).toEqual([{ name: "pick", shows: expect.stringContaining("c1"), env: expect.objectContaining({ EP0CH_WS: "garden", EP0CH_MACHINE: null }) }]);
    // Done: the next ctrl+t opens a picker again.
    await withEnv({ EP0CH_PICKER: "true" }, () => pickInto(tiles(seen), d, OUTLINE));
    expect(seen.length).toBe(2);
  });

  test("a screen that can't open a tile (no tiles, a locked screen): the person's terminal, as before", async () => {
    const d = draft("", 0), log: string[] = [];
    const ctx = { ...stepAside(log), inTile: () => false };
    expect(await withEnv({ EP0CH_PICKER: "echo" }, () => pickInto(ctx, d, OUTLINE, { channel: "((a1))" }))).toEqual({ inserted: "((a1))" });
    expect(log).toEqual(["picker"]);
  });
});

describe("ctrl+t and [insert] in a reader's edit (draft.pick)", () => {
  const note: Msg = { id: "11111111-2222-4333-8444-555555555555", text: "Shed list\nOil the chain.", parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 3, props: {} };
  const host = (said: string[]): SurfaceHost => ({
    ctx: { board: { path: OUTLINE.socket, outline: "garden", ancestors: async () => [], comments: async () => [] }, flash: (m: string) => said.push(m), t: { cellW: 9, cellH: 16 }, graphics: false, suspended: () => null, ...stepAside() } as any,
    redraw() {}, navigate() {},
  });

  test("ctrl+t is the draft's pick; the action puts the choice at the edit's cursor", async () => {
    expect(new Draft("n1", 1, "x").key({ kind: "char", ch: "t", ctrl: true })).toBe("pick");
    const s = new NoteSurface(), h = host([]);
    s.show(note, h);
    const d = s.startDraft({ ...note }, h).draft;
    d.place(1, Infinity);
    await withEnv({ EP0CH_PICKER: "echo" }, () => NOTE_ACTIONS.run("draft.pick", { channel: "((b2))" }, { surface: s, host: h }, USER));
    expect(d.text).toBe("Shed list\nOil the chain. ((b2))");
  });

  test("an agent's is refused by the dispatcher: it would take the person's terminal; nothing runs", async () => {
    const s = new NoteSurface(), h = host([]);
    s.show(note, h);
    s.startDraft({ ...note }, h);
    const ran: string[] = [];
    const was = pickRunner.run;
    pickRunner.run = async () => { ran.push("picker"); return 0; };
    try {
      const d = Dispatcher.of(NOTE_ACTIONS, { surface: s, host: h }, () => h.ctx as any);
      await expect(d.act({ action: "draft.pick", args: {} }, { kind: "agent", id: "helper-3" })).rejects.toThrow(/an agent doesn't hand the person's terminal to a picker/);
      // The board's new card says the same, through the same rule.
      expect(BOARD_ACTIONS.def("composer.pick")!.person).toContain("an agent doesn't hand the person's terminal to a picker");
    } finally { pickRunner.run = was; }
    expect(ran).toEqual([]);
  });

  test("the edit's title row offers [insert] beside [preview]; a click on it runs the host's pick", () => {
    const d = new Draft("n1", 1, "Shed list");
    const top = renderEditor(d, { title: "editing · Shed list", status: [], preview: () => [], pick: true }, 70, 10)[0]!;
    expect(top).toContain("[insert]");
    expect(top).toContain("[preview]");
    const ctl = d.frame!.controls.find(c => c.action === "pick")!;
    let picked = 0;
    expect(editorClick(d, ctl.from + 1, 0, false, USER, { pick: () => picked++ })).toBe(true);
    expect(picked).toBe(1);
    // A narrow frame keeps ctrl+t and drops the control.
    renderEditor(d, { title: "editing", status: [], preview: () => [], pick: true }, 44, 10);
    expect(d.frame!.controls.map(c => c.action)).toEqual(["preview"]);
  });
});
