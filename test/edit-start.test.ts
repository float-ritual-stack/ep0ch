// PIE-510: starting an edit, a comment or the property panel by key is the note's action (edit, passage.select,
// threads, props), the same one `act` runs, from the board's lanes, the desk's reader and the river: e, ctrl+e,
// C, m, i, I each run their named action as the person and land where they always did (the reader takes the keys,
// ctrl+e hands the draft to $EDITOR in a tile beside). Scratch services, fictional notes, EDITOR=true.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { DeliveryBoard } from "../src/desk/delivery";
import { Desk } from "../src/desk/desk";
import { River } from "../src/river/river";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { traceActions, type ActionRun } from "../src/surface/actions";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import * as BV from "./board-view";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

/** Each key that starts a session, the action it must run, and what it opens. */
const STARTS: { key: Key; name: string; action: string; args?: Record<string, unknown>; opens: "draft" | "session" | "panel" }[] = [
  { key: char("e"), name: "e", action: "edit", opens: "draft" },
  { key: ctrl("e"), name: "ctrl+e", action: "edit", opens: "draft" },
  { key: char("C"), name: "C", action: "passage.select", opens: "session" },
  { key: char("m"), name: "m", action: "threads", opens: "session" },
  { key: char("i"), name: "i", action: "props", opens: "panel" },
  { key: char("I"), name: "I", action: "props", opens: "panel" },
];

const term = (onKey: (f: (k: Key) => void) => void) => ({ info: { cols: 170, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey, onResize() {}, stop() {}, resume() {} });

/** Press `k`, and trace the actions it ran until `opened` holds. */
async function press(key: (k: Key) => void, k: Key, opened: () => boolean, what: string): Promise<ActionRun[]> {
  const runs: ActionRun[] = [];
  const stop = traceActions(r => runs.push(r));
  try { key(k); await until(opened, what, 5000); } finally { stop(); }
  return runs;
}

/** Close whatever the key opened, so the next key starts from reading. */
async function closeAll(s: any) {
  if (s.draft) { await until(() => !s.draft.busy && !/beside/.test(s.draft.note ?? ""), "the $EDITOR tile came back", 5000); s.closeDraftAction(true); }
  if (s.session) s.closeSession();
  if (s.panel) s.closePanel();
}

const opened = (s: any, opens: string) => () => opens === "draft" ? !!s.draft : opens === "session" ? !!s.session : !!s.panel;

describe.skipIf(!outliner)("starting an edit by key runs the edit action (PIE-510)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  const notes: Record<string, any> = {};

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EDITOR = "true";
    delete process.env.VISUAL;
    board = new SocketBoard(await scratch.start());
    await board.info();
    const mk = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
    notes.hedge = await mk(null, "Trim the hedge [type::job] [area::yard] [stage::todo]\nBefore the birds nest.");
    await mk(null, "Sweep the path [type::job] [area::yard] [stage::done]");
    notes.yard = await mk(null, "Yard jobs");
    await mk(notes.yard.id, "To do [type::virtual-branch] [query::type=job area=yard stage=todo]");
    await mk(notes.yard.id, "Done [type::virtual-branch] [query::type=job area=yard stage=done]");
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EDITOR"]) delete process.env[k];
  });

  test("the board's lanes: e ctrl+e C m i I edit the selected card in the preview through the note's actions", async () => {
    let key: (k: Key) => void = () => {};
    const app = new App(term(f => { key = f; }) as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    const b = new DeliveryBoard(notes.yard.id, false) as any;
    app.push(b);
    try {
      await until(() => b.lanes.length === 2 && b.lanes.every((l: any) => l.items), "the lanes", 10_000);
      for (const s of STARTS) {
        BV.at(b, "lanes");
        await until(() => b.preview.msg?.id === notes.hedge.id, "the preview shows the card");
        const surface = b.preview.surface;
        // m isn't a lane key (it moves the card); the preview's own m is checked on the desk.
        if (s.name === "m") continue;
        const runs = await press(key, s.key, opened(surface, s.opens), `${s.name} opened in the preview`);
        expect(runs.filter(r => r.actor.kind === "user").map(r => r.name), s.name).toContain(s.action);
        expect(BV.where(b), s.name).toBe("preview");
        // ctrl+e: $EDITOR runs in a terminal tile beside the preview, which has the keys until it exits.
        if (s.name !== "ctrl+e") await until(() => b.entered.in(b.preview), `${s.name}: the person is in the preview's session`);
        if (s.name === "ctrl+e") { await until(() => /no changes from true/.test(surface.draft?.note ?? ""), "$EDITOR came back", 5000); expect(BV.where(b)).toBe("preview"); }
        if (s.name === "I") expect(surface.panel.full).toBe(true);
        await closeAll(surface);
        b.entered.clear();
      }
    } finally { b.dispose?.(); }
  }, 60_000);

  test("the desk's reader: e ctrl+e C m i I run the note's actions, and the reader takes the keys", async () => {
    let key: (k: Key) => void = () => {};
    const app = new App(term(f => { key = f; }) as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    const desk = new Desk() as any;
    app.push(desk);
    try {
      desk.render(desk.ctx);
      await until(() => desk.panes.size > 0, "the desk's tiles", 10_000);
      await app.act({ action: "open", args: { id: notes.hedge.id }, as: "edit-start-test" });
      const readerOn = () => [...desk.panes.values()].find((p: any) => p.kind === "reader" && p.msg?.id === notes.hedge.id) as any;
      await until(() => !!readerOn(), "a reader on the note");
      for (const s of STARTS) {
        const rd = readerOn();
        desk.focus = [...desk.panes].find(([, p]: any) => p === rd)![0];
        const runs = await press(key, s.key, opened(rd.surface, s.opens), `${s.name} opened in the reader`);
        expect(runs.filter(r => r.actor.kind === "user").map(r => r.name), s.name).toContain(s.action);
        // ctrl+e: $EDITOR runs in a terminal tile beside the reader; when it exits the keys come back to the reader.
        if (s.name !== "ctrl+e") await until(() => desk.entered.in(rd), `${s.name}: the person is in the reader's session`);
        else { await until(() => /no changes from true/.test(rd.surface.draft?.note ?? ""), "$EDITOR came back", 5000); expect(desk.panes.get(desk.focus)).toBe(rd); }
        await closeAll(rd.surface);
        desk.entered.clear();
      }
    } finally { desk.dispose?.(); }
  }, 60_000);

  test("the river: e ctrl+e C m in the focused column run the note's actions", async () => {
    let key: (k: Key) => void = () => {};
    const app = new App(term(f => { key = f; }) as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    const river = new River() as any;
    app.push(river);
    try {
      await until(() => !!river.cols[0]?.panes[0].items?.length, "the Library", 10_000);
      await app.act({ action: "open", args: { id: notes.hedge.id }, as: "edit-start-test" });
      key(char("l"));
      const p = river.paneS;
      await until(() => p.surface.msg?.id === notes.hedge.id, "the column's note");
      for (const s of STARTS.filter(x => x.opens !== "panel")) {
        const runs = await press(key, s.key, opened(p.surface, s.opens), `${s.name} opened in the column`);
        expect(runs.filter(r => r.actor.kind === "user").map(r => r.name), s.name).toContain(s.action);
        await until(() => river.entered?.p === p, `${s.name}: the person is in the column's session`);
        if (s.name === "ctrl+e") await until(() => /no changes from true/.test(p.surface.draft?.note ?? ""), "$EDITOR came back", 5000);
        await closeAll(p.surface);
        river.entered = null;
      }
    } finally { river.dispose?.(); }
  }, 60_000);
});
