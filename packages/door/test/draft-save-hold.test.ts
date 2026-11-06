// Keys typed while a draft saves land (PIE-1613), as they do during a reload (draft-reload.test.ts): one hold, one phase.
// Refused: they go in where they were typed. Written: the session ends, so what they added is kept and said. A command
// never runs late. The session's rule on a fake target whose write waits on a gate; hosts on fake outlines. Made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Msg } from "../src/board";
import { CommentSession } from "../src/comment";
import { DraftSession, unsent, type DraftTarget, type Outcome } from "../src/draft-session";
import { Inspector } from "../src/surface/inspector";
import type { Key } from "../src/term";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const until = async (ok: () => boolean, what: string) => { const end = Date.now() + 3000; while (!ok()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await Bun.sleep(2); } };
function gated<T>() { let open!: (v: T) => void; const answer = new Promise<T>(res => { open = res; }); return { answer, open }; }

const stateWas = process.env.EP0CH_STATE;
let state = "";
beforeAll(() => { state = mkdtempSync(join(tmpdir(), "draft-save-hold-")); process.env.EP0CH_STATE = state; });
afterAll(() => { if (stateWas === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = stateWas; rmSync(state, { recursive: true, force: true }); });

let places = 0;
function saving(text = "Sowing beans", over: Partial<DraftTarget> = {}) {
  const write = gated<Outcome>();
  const seen: string[] = [];
  const target: DraftTarget = {
    place: `edit:hold-${++places}`, back: "e brings it back", label: "sowing", what: "the edit", verb: "save", leaveWrites: true,
    async submit(s) { seen.push(s.draft.text); return write.answer; },
    ...over,
  };
  const said: string[] = [];
  const s = DraftSession.open(target, { text, base: 1 }, { said: m => said.push(m) });
  const run: string[] = [];
  const host = { completer: null, run: (cmd: string) => { run.push(cmd); } };
  return { s, d: s.draft, write, seen, said, run, target, press: (k: Key) => s.key(k, host) };
}

describe("the session holds keys during a write (a fake target)", () => {
  test("a stale refusal keeps the word typed after ctrl+s, in place, with the copy holding it", async () => {
    const { s, d, write, press } = saving();
    d.place(0, 3);
    const landing = s.submit();
    expect(d.status.saving).toBe(true);
    for (const c of "XY") press(char(c));
    expect(d.text).toBe("Sowing beans");
    write.open({ ok: false, why: "changed elsewhere since you started · not saved", stale: true });
    const r = await landing;
    expect(r.ok).toBe(false);
    expect(d.text).toBe("SowXYing beans");
    expect(d.status.conflict).toContain("not saved");
    expect(d.note).toContain("copied to");
    expect(await Bun.file(d.status.savedCopy!).text()).toBe("SowXYing beans\n");
    expect(s.open).toBe(true);
    s.dispose();
  });

  test("any other refusal: the same, and what it said stays on the line", async () => {
    const { s, d, write, press } = saving();
    const landing = s.submit();
    press(char("!"));
    press({ kind: "paste", text: " now" });
    write.open({ ok: false, why: "offline", said: "not saved: offline" });
    await landing;
    expect(d.text).toBe("Sowing beans! now");
    expect(d.note).toBe("not saved: offline");
    s.dispose();
  });

  test("a written save: the session ends, what was typed is kept on the new revision, and it says where", async () => {
    const { s, d, write, press, said, target } = saving();
    const landing = s.submit();
    for (const c of " soon") press(char(c));
    write.open({ ok: true, revision: 7 });
    const r = await landing;
    expect(r.ok).toBe(true);
    expect(s.open).toBe(false);
    const kept = unsent(target.place)!;
    expect(kept.text).toBe("Sowing beans soon");
    expect(kept.base).toBe(7);
    expect(said.join()).toContain("what you typed while it saved is kept");
    expect(said.join()).toContain("e brings it back");
    expect(await Bun.file(d.status.savedCopy!).text()).toBe("Sowing beans soon\n");
  });

  test("a written save with only moves typed after it keeps nothing and says nothing", async () => {
    const { s, write, press, said, target } = saving();
    const landing = s.submit();
    press({ kind: "left" });
    write.open({ ok: true, revision: 7 });
    await landing;
    expect(s.open).toBe(false);
    expect(unsent(target.place)).toBeNull();
    expect(said).toEqual([]);
  });

  test("a sent comment or created card: only what came after it is kept, never the words already sent", async () => {
    for (const verb of ["send", "create"] as const) {
      const { s, write, press, said, target } = saving("Is the bed deep enough?", { verb, leaveWrites: false, back: "C brings it back" });
      const landing = s.submit();
      for (const c of "and") press(char(c));
      write.open({ ok: true });
      await landing;
      expect(unsent(target.place)!.text).toBe("and");
      expect(said.join()).toContain("C brings it back");
    }
  });

  test("a command during the write doesn't run late; the line says, and says again once it's refused", async () => {
    const { s, d, write, press, run } = saving();
    const landing = s.submit();
    press(char("a"));
    press(ctrl("s"));
    press({ kind: "esc" });
    press(ctrl("r"));
    expect(d.note).toBe("saving · press ctrl+s, esc, ctrl+r again once it has saved");
    write.open({ ok: false, why: "offline", said: "not saved: offline" });
    await landing;
    expect(run).toEqual([]);
    expect(d.text).toBe("Sowing beansa");
    expect(d.note).toStartWith("ctrl+s, esc, ctrl+r didn't run: press them again · ");
    expect(d.note).toContain("not saved: offline");
    s.dispose();
  });

  test("a save that's written drops a command typed meanwhile: there's nothing left for it to act on", async () => {
    const { s, write, press, run, said } = saving();
    const landing = s.submit();
    press({ kind: "esc" });
    write.open({ ok: true, revision: 2 });
    await landing;
    expect([s.open, run, said]).toEqual([false, [], []]);
  });

  test("the hold starts with the write, before its target says a phase, and lasts until its answer", async () => {
    const gate = gated<void>(), after = gated<void>();
    const { s, d, press } = saving("Sowing", {
      async submit(_s, _by, { report }) {
        await gate.answer;                // nothing said yet
        report.phase("checking");
        await after.answer;
        return { ok: false, why: "offline" };
      },
    });
    const landing = s.submit();
    press(char("a"));
    gate.open();
    await until(() => d.status.phase === "checking", "the check");
    press(char("b"));
    expect(d.text).toBe("Sowing");
    after.open();
    await landing;
    expect(d.text).toBe("Sowingab");
    s.dispose();
  });

  test("a target that throws: the keys still land", async () => {
    const { s, d, press } = saving("Sowing", { async submit() { await Bun.sleep(5); throw new Error("boom"); } });
    const landing = s.submit();
    press(char("a"));
    await expect(landing).rejects.toThrow("boom");
    expect(d.text).toBe("Sowinga");
    expect(d.busy).toBe(false);
    s.dispose();
  });

  test("a second write can't start while one is out; nor a close", async () => {
    const { s, write } = saving();
    const landing = s.submit();
    expect((await s.submit()).ok).toBe(false);
    expect(() => s.close(true)).toThrow("still landing");
    write.open({ ok: false, why: "offline" });
    await landing;
    s.dispose();
  });
});

describe("every host's key path reaches the hold", () => {
  const msg = { id: "note-bed", title: "Bed", text: "Bed\nThe plot", revision: 1 } as unknown as Msg;
  function commenting(comment: (...a: unknown[]) => Promise<unknown>) {
    const flashes: string[] = [];
    const env: any = { board: { comment, async comments() { return []; } }, fetch: async () => msg, setMsg() {}, reloadComments: async () => [], external() {}, flash: (m: string) => flashes.push(m), redraw() {} };
    const s = new CommentSession(msg, [], "threads");
    (s as any).env = env; s.writeNote();
    return { s, env, w: s.writing!, flashes };
  }

  test("a comment: typed during a refused send lands where it was typed", async () => {
    const answer = gated<void>();
    const { s, env, w } = commenting(async () => { await answer.answer; throw new Error("offline"); });
    for (const c of "Deep?") s.key(char(c), env);
    const sending = s.send(env);
    await until(() => w.status.saving, "the send");
    for (const c of " Yes") s.key(char(c), env);
    expect(w.draft.text).toBe("Deep?");
    answer.open();
    await sending;
    expect(w.draft.text).toBe("Deep? Yes");
    expect(w.open).toBe(true);
    s.writing?.dispose();
  });

  test("a comment: typed during a send that lands is kept, also while the thread reloads", async () => {
    const answer = gated<void>(), list = gated<never[]>();
    const { s, env, w, flashes } = commenting(async () => { await answer.answer; return { id: "c-1" }; });
    env.reloadComments = () => list.answer;
    for (const c of "Deep?") s.key(char(c), env);
    const sending = s.send(env);
    await until(() => w.status.saving, "the send");
    s.key(char("A"), env);
    answer.open();
    await until(() => s.writing === null, "the landing");
    s.key(char("B"), env);              // the thread is reloading: still the draft's, never the list's
    list.open([]);
    await sending;
    expect(w.open).toBe(false);
    expect(unsent(w.target.place)!.text).toBe("AB");
    expect(flashes.join(" ")).toContain("what you typed while it sent is kept");
  });

  test("an inspector field: typed during a refused save lands", async () => {
    const answer = gated<void>();
    const v = new Inspector();
    await v.edit("crop", "leek", [], false, `field:${++places}`, async () => { await answer.answer; throw new Error("offline"); }, {});
    const f = v.field!, d = f.session.draft;
    v.key({ kind: "end" });
    const saving = v.input("save");
    await until(() => d.busy, "the save");
    for (const c of "s!") v.key(char(c));
    expect(d.text).toBe("leek");
    answer.open();
    await saving;
    expect(d.text).toBe("leeks!");
    f.session.dispose();
  });
});
