// One status line (PIE-1560): what a write is doing and what it did is said where the person is typing, in every view.
// Made-up notes; no service.
import { describe, expect, test } from "bun:test";
import { CommentSession } from "../src/comment";
import { DraftSession, type DraftTarget, type Outcome } from "../src/draft-session";
import { Refused, USER } from "../src/socket";
import { visible } from "../src/style";
import { elementEdit } from "../src/surface/element-editor";
import { renderEditor, saidRows } from "../src/surface/editor";
import { composerBox } from "../src/surface/composer";
import type { Key } from "../src/term";

const char = (ch: string): Key => ({ kind: "char", ch });
const until = async (ok: () => boolean, what: string) => { const end = Date.now() + 3000; while (!ok()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await Bun.sleep(5); } };

describe("the one status line", () => {
  test("rich cells say a save is under way while it lands", async () => {
    let land!: (o: Outcome) => void;
    const target: DraftTarget = { place: "edit:plan", back: "e", label: "plan", what: "the plan", verb: "save", leaveWrites: true,
      async submit(_s, _by, { report }) { report.phase("saving"); const o = await new Promise<Outcome>(r => { land = r; }); return o; } };
    const s = DraftSession.open(target, { text: "Beds\n\n| crop | bed |\n| --- | --- |\n| leek | 3 |", base: 2 });
    const d = s.draft, rich = elementEdit(d);
    d.place(d.lines.length - 1, 3); rich.open(USER);
    const draw = (t: string, _w: number) => { const lines = t.split("\n"); return { lines, source: lines.map((_, i) => i) }; };
    const saving = s.submit(USER);
    expect(rich.render(40, 10, draw).map(visible).join("\n")).toContain("saving…");
    land({ ok: true });
    await saving;
  });

  test("a posted comment's edit has the note edit's lifecycle: changed elsewhere, not saved with its copy, reload", async () => {
    const thread = { id: "c-2", author: "user", body: "Cut the hedge?", quote: "", at: 0, open: true, lifecycle: "open" as const, start: null, end: null, replies: [], revision: 5 };
    const msg = { id: "note-hedge", title: "Hedge", text: "Hedge\nCut it", revision: 1 } as any;
    const now = { ...thread, body: "Cut the hedge in March?", revision: 6 };
    const env: any = {
      board: { async updateComment() { throw new Refused("revision is stale", "stale-revision"); } },
      fetch: async () => msg, setMsg() {}, reloadComments: async () => [now], external() {}, flash() {}, redraw() {},
    };
    const s = new CommentSession(msg, [thread as any], "threads");
    expect(s.editMark(0)).toBeNull();
    const w = s.writing!, w_ = w;
    w.draft.key(char("!"));
    const frame = (w = 80) => renderEditor(w_.draft, s.composerFrame()!, w, 20).map(visible).join("\n");
    // The service's comments come back with the comment at a newer revision: the edit says so before any save.
    s.commentsChanged([now as any]);
    expect(frame()).toContain("changed elsewhere");
    s.key({ kind: "char", ch: "s", ctrl: true }, env);
    await until(() => w.status.conflict !== null, "the stale refusal");
    expect(frame()).toContain("not saved");
    expect(frame()).toContain("copied to");
    // At 44 columns too: "not saved" first, and the copy's file named, its folder shortened.
    expect(frame(44)).toContain("not saved");
    expect(frame(44).replace(/\s+/g, "")).toContain(w.status.savedCopy!.split("/").at(-1)!);
    expect(s.hint()).toContain("reload");
    await s.reload(env);
    expect(w.draft.text).toBe("Cut the hedge in March?");
    expect(frame()).toContain("loaded revision 6");
  });

  test("ctrl+r on a posted comment's stale edit says the revision it loaded and where the earlier words are", async () => {
    const thread = { id: "c-1", author: "user", body: "Swap Thursdays?", quote: "", at: 0, open: true, lifecycle: "open" as const, start: null, end: null, replies: [], revision: 3 };
    const msg = { id: "note-rota", title: "Rota", text: "Rota\nThursdays", revision: 1 } as any;
    const now = { ...thread, body: "Swap Fridays?", revision: 4 };
    const env: any = {
      board: { async updateComment() { throw new Refused("revision is stale", "stale-revision"); } },
      fetch: async () => msg, setMsg() {}, reloadComments: async () => [now], external() {}, flash() {}, redraw() {},
    };
    const s = new CommentSession(msg, [thread as any], "threads");
    expect(s.editMark(0)).toBeNull();
    const w = s.writing!;
    w.draft.key(char("!"));
    s.key({ kind: "char", ch: "s", ctrl: true }, env);
    await until(() => w.status.conflict !== null, "the stale refusal");
    await s.reload(env);
    expect(w.draft.text).toBe("Swap Fridays?");
    expect(w.draft.note).toContain("loaded revision 4");
    expect(w.draft.note).toContain("your earlier draft is at");
  });

  // A stale posted comment's edit, ready to be drawn: the session, its draft and its env.
  async function staleEdit(update: () => Promise<never>, reload: () => Promise<any[]>) {
    const thread = { id: "c-3", author: "user", body: "Rake the leaves?", quote: "", at: 0, open: true, lifecycle: "open" as const, start: null, end: null, replies: [], revision: 2 };
    const msg = { id: "note-leaves", title: "Leaves", text: "Leaves\nRake", revision: 1 } as any;
    const env: any = { board: { updateComment: update }, fetch: async () => msg, setMsg() {}, reloadComments: reload, external() {}, flash() {}, redraw() {} };
    const s = new CommentSession(msg, [thread as any], "threads");
    expect(s.editMark(0)).toBeNull();
    const w = s.writing!;
    w.draft.key(char("!"));
    s.key({ kind: "char", ch: "s", ctrl: true }, env);
    await until(() => !w.busy && (w.status.conflict !== null || !!(s as any).error), "the refusal");
    return { s, w, env, frame: (cols: number) => renderEditor(w.draft, s.composerFrame()!, cols, 20).map(visible).join("\n") };
  }

  test("a short split keeps a row of the text being typed under a stale edit's status", async () => {
    const { s, w } = await staleEdit(async () => { throw new Refused("revision is stale", "stale-revision"); }, async () => []);
    const box = composerBox(w.draft, s.composerFrame()!, 30, 8, true);
    expect(box.lines.length).toBeLessThanOrEqual(8);
    expect(box.lines.map(visible).join("\n")).toContain("Rake the leaves?!");
  });

  test("a copy's file name stays whole in a narrow status, the full path kept for the reveal", () => {
    const file = "a7ee1cbe-comment-edit-2026-11-03T20-42-17-561Z.md";
    const rows = saidRows(`your draft is kept and copied to /home/gardener/.state/drafts/${file} · ctrl+r loads the current text`, 24, 4, 0);
    expect(rows.length).toBeLessThanOrEqual(4);
    expect(rows.map(visible).join("").replace(/\s+/g, "")).toContain(file);
  });

  test("one row left: the copy's two ends and the reload key", () => {
    const file = "a7ee1cbe-comment-edit-2026-11-03T20-42-17-561Z.md";
    const [row, ...rest] = saidRows(`your draft is kept and copied to /home/gardener/.state/drafts/${file} · ctrl+r loads the current text`, 26, 1, 0);
    expect(rest).toEqual([]);
    expect(visible(row!)).toStartWith("a7ee1cbe");
    expect(visible(row!)).toContain("Z.md");
    expect(visible(row!).trim()).toEndWith("^R");
  });

  test("an offline save names its copy at 44 columns, bounded like every status", async () => {
    const { w, frame } = await staleEdit(async () => { throw new Error("offline"); }, async () => []);
    const copy = w.status.savedCopy ?? frame(80).match(/[\w-]+-comment-edit-[\w-]+\.md/)?.[0];
    expect(copy).toBeTruthy();
    const at44 = frame(44);
    expect(at44.split("\n").every(l => Bun.stringWidth(l) <= 44)).toBe(true);
    expect(at44.replace(/\s+/g, "")).toContain(copy!.split("/").at(-1)!);
  });
});
