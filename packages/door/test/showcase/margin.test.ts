// PIE-439: the showcase screen, the margin: marginalia, attention and replies. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { osc52 } from "../../src/surface/selection";
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../../src/app";
import type { Desk } from "../../src/desk/desk";
import { spanBg } from "../../src/surface/margin";
import { MARGINALIA_FILE, type Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase } from "../../src/showcase/showcase";
import { SocketBoard, USER } from "../../src/socket";
import { subject } from "../../src/board";
import { makeTile } from "../../src/desk/tiles";
import type { ReaderPane } from "../../src/desk/panes";
import { outliner, Scratch, until } from "../scratch";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};
import { UNREAD_REPLIES_QUERY } from "@ep0ch/outline-core/recent-replies";


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("the showcase screen: the margin: marginalia, attention and replies", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });


  test("marginalia (PIE-751, PIE-753): an agent highlights, asks, defines and cites a passage of the plan and of the leaflet through act; the person by mouse (a chip on the selection's line) and keys (a then its key); the notebook lists them", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "marginalia" }, as: "test-agent" })).toMatchObject({ key: "marginalia" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "marginalia")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    const leaflet = () => tiles().find(t => String(t.showing?.id ?? "").startsWith("resource:"));
    await until(() => !!leaflet() && screen().includes("A cold frame is a bottomless box"), "the plan and the leaflet", 8000);
    const plan = seeded.notes.marginalia;
    const act = (tile: string, args: Record<string, unknown>) => app.act({ action: "passage.act", tile, args, as: "test-agent" }) as Promise<any>;
    const threads = () => board.comments(plan.id);
    const waitFor = async (ok: () => Promise<boolean>, what: string, ms = 5000) => {
      const end = Date.now() + ms;
      while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
    };
    // The seeded highlight is drawn on its words in its tone (warn: the amber surface, capped dark); the answered question has a card.
    const raw = () => sc.render(app).lines as string[];
    await until(() => raw().some(l => l.includes(spanBg({ kind: ["highlight"], color: ["warn"] }))), "the seeded highlight drawn", 5000);
    expect(tiles().find(t => t.name === "notebook")?.showing?.id).toBe(seeded.notes.marginaliaNotebook.id);
    expect(screen()).toContain("question · ");
    // Highlight: the kit's passage action, written as ext:marginalia at the agent's request.
    const hl = await act("plan", { action: "ext.marginalia.highlight", quote: "soil pH near 6.5", color: "good" });
    expect(hl.written).toHaveLength(1);
    await waitFor(async () => (await threads()).some(t => t.quote === "soil pH near 6.5"), "the highlight listed", 5000);
    // A repeated passage is refused with why; near= says which.
    await expect(act("plan", { action: "ext.marginalia.define", quote: "cold frame" })).rejects.toThrow(/2 times/);
    const define = await act("plan", { action: "ext.marginalia.define", quote: "soil pH", near: plan.text.lastIndexOf("soil pH") });
    expect(define.written).toHaveLength(1);
    // Cite: the quote and its line's fragment, returned to the agent; the person's clipboard untouched.
    const before = written.length;
    const cite = await act("plan", { action: "ext.marginalia.cite", quote: "Water the tomatoes at dawn" });
    expect(cite).toMatchObject({ copy: `> Water the tomatoes at dawn\n> — ((${plan.id}^water))`, clipboard: false });
    expect(written.slice(before).some(w => w.includes("\x1b]52;"))).toBe(false);
    // An agent's Ask is a question on the passage, but an agent's @margin never sets the agent off (no loops): it waits for a person.
    const asked = await act("plan", { action: "ask", quote: "Sow the basil", question: "why ten degrees?" });
    await waitFor(async () => !!(await threads()).find(t => t.id === asked.thread), "the agent's question", 5000);
    expect((await board.comments(plan.id)).find(t => t.id === asked.thread)).toMatchObject({ props: { kind: ["question"] }, replies: [] });
    // The same on the leaflet: a Resource's passage, annotated in the outline, the file never written.
    const file = readFileSync(MARGINALIA_FILE(), "utf8");
    const onFile = await act(leaflet().name, { action: "ext.marginalia.highlight", quote: "Watch the thermometer, not the calendar." });
    expect(onFile.passage.subject).toBe(leaflet().showing.id);
    const resourceId = String(leaflet().showing.id).slice("resource:".length);
    await waitFor(async () => (await board.request<any[]>("annotations.list", { query: { subject: { kind: "resource", resourceId }, includeResolved: true } })).some(t => t.properties?.kind?.[0] === "highlight"), "the leaflet's highlight", 5000);
    expect(readFileSync(MARGINALIA_FILE(), "utf8")).toBe(file);
    // The person: into the stage, a drag over words, a click on the toolbar's Highlight chip.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    const drag = (words: string) => {
      const ls = screen().split("\n"), y = ls.findIndex(l => l.includes(words) && !l.includes("Select any words")), x = ls[y]!.indexOf(words);
      press({ kind: "mouse", action: "down", button: 0, x, y });
      press({ kind: "mouse", action: "drag", button: 0, x: x + 2, y });
      press({ kind: "mouse", action: "drag", button: 0, x: x + words.length - 1, y });
      press({ kind: "mouse", action: "up", button: 0, x: x + words.length - 1, y });
    };
    drag("the chillies want it");
    await until(() => screen().includes("[Highlight h]"), "the passage toolbar", 5000);
    const ls = screen().split("\n"), ty = ls.findIndex(l => l.includes("[Highlight h]")), tx = ls[ty]!.indexOf("[Highlight h]") + 2;
    press({ kind: "mouse", action: "down", button: 0, x: tx, y: ty }); press({ kind: "mouse", action: "up", button: 0, x: tx, y: ty });
    await waitFor(async () => (await threads()).some(t => t.quote === "the chillies want it"), "the person's highlight", 5000);
    // Keys: a selection, then a k copies it with a citation to the person's clipboard.
    drag("Sow the basil only");
    await until(() => screen().includes("[Cite k]"), "the toolbar again", 5000);
    const mark = written.length;
    press({ kind: "char", ch: "a" }); press({ kind: "char", ch: "k" });
    await until(() => written.slice(mark).some(w => w.includes(osc52(`> Sow the basil only\n> — ((${plan.id}))`))), "the citation copied", 5000);
    // Ask by keys: a selection, a a opens the comment on it with @margin written, the question typed, ctrl+s sends; the answer
    // lands in its margin thread (from the note itself: no model in a test).
    drag("nights stay above ten degrees");
    await until(() => screen().includes("[Ask a]"), "the toolbar with Ask", 5000);
    press({ kind: "char", ch: "a" }); press({ kind: "char", ch: "a" });
    await until(() => screen().includes("^S send") && screen().includes("» question"), "the question started with @margin, the person in it, at its passage", 5000);
    for (const c of "why ten?") press({ kind: "char", ch: c });
    press({ kind: "char", ch: "s", ctrl: true });
    await waitFor(async () => (await board.comments(plan.id)).some(t => t.body.startsWith("@margin why ten?") && t.replies.some(r => r.author === "ext:marginalia")), "the margin's answer", 10_000);
    // Sent, the comment session closes: the person is reading again.
    await until(() => !screen().includes("ctrl+s send"), "the comment sent and closed", 5000);
    // M: the margin's cards whole, then off (the highlights stay), then a row each again.
    press({ kind: "char", ch: "M" });
    await until(() => screen().includes("Why ten days, not a week?"), "the question's card whole", 5000);
    press({ kind: "char", ch: "M" }); press({ kind: "char", ch: "M" });
    // The notebook: a saved query over every annotation, the plan's among them.
    const book = await board.readSavedView(seeded.notes.marginaliaNotebook.id);
    expect(book?.blocks.filter(b => b.parentId === plan.id).length).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);


  test("comment folds leave only their gutter controls (PIE-910)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "marginalia" }, as: "test-agent" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "marginalia")).top as Desk; };
    const threads = await board.comments(seeded.notes.marginalia.id);
    const whole = threads.find(c => c.body === "Keep this plan beside the seed trays.")!;
    const passage = threads.find(c => c.body === "Why ten days, not a week?")!;
    await until(() => screen().includes("question · "), "the comments loaded", 8000);
    const act = (action: string, args: Record<string, unknown>) => stage().dispatch.act({ action, args, tile: "plan" }, { kind: "agent", id: "test-agent" });
    for (const thread of [passage, whole]) {
      await act("thread.toggle", { thread: thread.id, expand: true });
      expect(screen()).toContain(thread.body);
      await act("thread.toggle", { thread: thread.id, expand: false });
      expect(screen()).not.toContain(thread === passage ? "Try the lid half open" : thread.body);
      expect(screen()).toContain("[+]");
    }
    await act("thread.toggle", { thread: whole.id, expand: true });
    expect(screen()).toContain(whole.body);
    await stage().dispatch.press("select", { text: "Sow the basil" }, "plan");
    await act("margin", { mode: "off" });
    expect(await stage().dispatch.press("select.copy", {}, "plan")).toMatchObject({ text: "Sow the basil" });
    await stage().dispatch.press("select.clear", {}, "plan");
    await stage().dispatch.press("select", { text: "Move the leeks to the cold frame in the second week of March, and harden them off for ten days.\nSow the basil only once the nights stay above ten degrees." }, "plan");
    const selectedSource = await stage().dispatch.press("select.copy", { source: true }, "plan");
    await act("thread.toggle", { thread: passage.id, expand: true });
    expect(await stage().dispatch.press("select.copy", { source: true }, "plan")).toEqual(selectedSource);
    await stage().dispatch.press("select.clear", {}, "plan");
    await act("thread.toggle", { thread: passage.id, expand: false });
    expect(screen()).not.toContain(whole.body);
    expect(screen()).not.toContain("[Reply]");
    expect(screen()).toContain("marks (M)");
    const lines = screen().split("\n"), y = lines.findIndex(l => l.includes("Greenhouse plan") && l.includes("[+]"));
    expect(y).toBeGreaterThanOrEqual(0);
    const x = lines[y]!.indexOf("[+]");
    press({ kind: "mouse", action: "down", button: 0, x, y });
    press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => screen().includes(whole.body), "only the clicked whole-note card opens");
    expect(screen()).not.toContain(passage.body);
    expect(screen()).not.toContain("Try the lid half open");
    await act("margin", { mode: "trim" });
    expect(screen()).toContain(whole.body);
    for (const thread of [passage, whole]) await act("thread.toggle", { thread: thread.id, expand: true });
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);


  // PIE-873: marks only is found where the comments are counted, and kept: a click on the byline's count cycles the margin
  // (as M), off reads "marks only (M)" there, and the mode goes with the tile's spec and to a reader opened from it.
  test("marks only (PIE-873): a click on the comment count cycles the margin to marks only, said there; kept in the tile's spec and taken by a reader opened from it", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "marginalia" }, as: "test-agent" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "marginalia")).top as any; };
    await until(() => screen().includes("question · ") && / comments? · shown \(M\)/.test(screen()), "the plan with its cards and count", 8000);
    const planId = [...stage().panes.keys()].find((id: number) => stage().nameOf(id) === "plan") as number;
    const plan = () => stage().panes.get(planId) as ReaderPane;
    expect(plan().surface.marginMode).toBe("trim");
    const click = (re: RegExp) => {
      const ls = screen().split("\n"), y = ls.findIndex(l => re.test(l));
      expect(y, screen()).toBeGreaterThanOrEqual(0);
      const x = ls[y]!.search(re) + 3;
      press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    };
    click(/■ \d+( comments?)? · (shown|full) \(M\)/);
    await until(() => plan().surface.marginMode === "full", "cards whole");
    click(/■ \d+( comments?)? · (shown|full) \(M\)/);
    await until(() => /■ \d+( comments?)? · marks \(M\)/.test(screen()), "the count says marks only");
    expect(plan().surface.marginMode).toBe("off");
    expect(screen()).not.toContain("question · ");
    // Kept with the tile: its spec (what a layout, a handover and a restart save) says so, and a tile made from it reads the same.
    const spec = stage().specOf(planId);
    expect(spec.margin).toBe("off");
    expect((makeTile({ ...spec }) as ReaderPane).surface.marginMode).toBe("off");
    // A reader opened from it (alt+⏎, a ctrl-click) starts marks only too.
    const before = new Set(stage().panes.keys());
    expect(stage().openReader(plan().msg, { kind: "split", target: planId, dir: "right" }, USER)).toBe(true);
    const opened = [...stage().panes.keys()].find((id: number) => !before.has(id)) as number;
    expect((stage().panes.get(opened) as ReaderPane).surface.marginMode).toBe("off");
    await stage().dispatch.press("tile.close", {}, stage().nameOf(opened));
    // As it was, for the tests after.
    click(/■ \d+( comments?)? · marks \(M\)/);
    await until(() => plan().surface.marginMode === "trim", "a row each again");
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);


  test("margin attention: the kept thread's TL;DR is its card, the seen one is off the margin; thread.seen puts the current one on the earlier shelf and back=true brings it back (PIE-791)", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "margin-attention" }, as: "test-agent" })).toMatchObject({ key: "margin-attention" });
    await until(() => screen().includes("TL;DR Sewing") && screen().includes("Could we swap"), "the rota's margin", 8000).catch(e => { console.log(screen()); throw e; });
    expect(screen()).not.toContain("spare washers");
    const rota = seeded.notes.attention;
    const current = (await board.comments(rota.id)).find(t => t.body.startsWith("Could we swap"))!;
    expect(await app.act({ action: "thread.seen", tile: "rota", args: { thread: current.id } })).toMatchObject({ lifecycle: "seen" });
    expect((await board.comments(rota.id)).find(t => t.id === current.id)!.lifecycle).toBe("seen");
    await until(() => screen().includes("1 current · 2 earlier"), "the thread list's shelves", 5000);
    expect(await app.act({ action: "thread.seen", tile: "rota", args: { thread: current.id, back: true } })).toMatchObject({ lifecycle: "open" });
    await until(() => screen().includes("2 current · 1 earlier"), "the thread back", 5000);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);


  // PIE-860: the kept thread's TL;DR shown once when expanded, taken away by a click on [No TL;DR]; asked again with no
  // model set up for @margin, none is written and the ask says how to set one up.
  test("margin attention: a TL;DR once, as the face; [No TL;DR] by a click takes it away; with no model none is written and it says why (PIE-860)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "margin-attention" }, as: "test-agent" });
    await until(() => screen().includes("TL;DR Sewing"), "the rota's margin", 8000);
    const stage = () => S().stages.get(S().sel).top;
    const rota = seeded.notes.attention;
    const oil = async () => (await board.comments(rota.id)).find(t => t.body.startsWith("Which oil"))!;
    const cs = () => stage().pane("rota").surface.session;
    if (cs()) await stage().dispatch.press("comment.close", {}, "rota");
    await stage().dispatch.press("thread.toggle", { thread: (await oil()).id, expand: true }, "rota");
    const rows = () => sc.render(app).lines.map(plain);
    await until(() => rows().some(l => l.includes("[No TL;DR]")), "the thread expanded, its TL;DR controls");
    expect(rows().join("\n").split("TL;DR Sewing").length - 1).toBe(1);
    const y = rows().findIndex(l => l.includes("[No TL;DR]")), x = rows()[y]!.indexOf("[No TL;DR]") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    for (let i = 0; i < 80 && (await oil()).tldr; i++) await Bun.sleep(100);
    expect((await oil()).tldr).toBeUndefined();
    await until(() => !rows().some(l => l.includes("[No TL;DR]")) && rows().some(l => l.includes("[TL;DR]")), "the thread without one");
    // Asked again: this showcase's @margin has no model, so none is written and it says how to set one up.
    await stage().dispatch.press("thread.tldr", { thread: (await oil()).id }, "rota");
    await until(() => /no TL;DR: no model is set up to write one · name one in .*config\.json/.test(cs()?.error ?? ""), "why, with the fix");
    expect((await oil()).tldr).toBeUndefined();
    // As it was: the seed's TL;DR back (the person's own, written), for the tests after.
    await board.tldr((await oil()).id, USER, "Sewing machine oil on the hose reel, each spring.");
    if (cs()) await stage().dispatch.press("comment.close", {}, "rota");
    await stage().dispatch.press("thread.toggle", { thread: (await oil()).id, expand: true }, "rota");
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);


  test("margin attention: a posted comment edited by keys (m, e) and a reply by a click on its [Edit], in the comment editor; both show as edited; an agent's edit is attributed, a stale one refused (PIE-763)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "margin-attention" }, as: "test-agent" });
    await until(() => screen().includes("TL;DR Sewing") && screen().includes("Could we swap"), "the rota's margin", 8000);
    const stage = () => S().stages.get(S().sel).top;
    const cs = () => stage().pane("rota").surface.session;
    const d = () => cs()?.composer;
    const rota = seeded.notes.attention;
    const thread = async (start: string) => (await board.comments(rota.id)).find(t => t.body.startsWith(start))!;
    // The thread list an agent's thread.seen left open (the test before) is closed: the person opens their own.
    if (cs()) await stage().dispatch.press("comment.close", {}, "rota");
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // Keys: m lists the threads, j k to the question, e edits its words in the comment editor, ctrl+s saves.
    ch("m");
    await until(() => cs()?.mode === "threads", "the thread list");
    for (let i = 0; i < 5 && !cs()!.threads[cs()!.sel]?.body.startsWith("Could we swap"); i++) press({ kind: "char", ch: "j" });
    ch("e");
    await until(() => cs()?.mode === "compose" && d()?.text === "Could we swap Thursdays in August?", "the comment's words in the editor");
    expect(plain(sc.render(app).lines.join("\n"))).toMatch(/edit \S+'s comment/);
    // ctrl+s on words unchanged closes it, nothing written.
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => cs()?.mode === "threads" && !cs()?.busy, "an unchanged edit closed");
    expect((await thread("Could we swap")).edited).toBeUndefined();
    ch("e");
    await until(() => cs()?.mode === "compose" && d()?.text === "Could we swap Thursdays in August?", "the editor again");
    press({ kind: "end" }); press({ kind: "backspace" });
    for (const c of ", from the 4th?") ch(c);
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => cs()?.mode === "threads" && !cs()?.busy, "the edit saved", 8000);
    const question = await thread("Could we swap");
    expect([question.body, !!question.edited, question.replies.length]).toEqual(["Could we swap Thursdays in August, from the 4th?", true, 0]);
    await until(() => screen().includes("· edited"), "the thread list marks it edited");
    press({ kind: "esc" });
    await until(() => !cs(), "the list closed");
    // Mouse: the kept thread expanded, a click on its reply's [Edit] opens the same editor on the reply's words.
    const oil = await thread("Which oil");
    await stage().dispatch.press("thread.toggle", { thread: oil.id, expand: true }, "rota");
    const rows = () => sc.render(app).lines.map(plain);
    let r = rows(), y = r.findIndex(l => l.includes("└ ") && l.includes("[Edit]"));
    expect(y, r.join("\n")).toBeGreaterThan(0);
    const x = r[y]!.indexOf("[Edit]") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => cs()?.mode === "compose" && d()?.text === "Sewing machine oil: thin, and it doesn't gum.", "the reply's words in the editor", 8000);
    press({ kind: "end" });
    for (const c of " Not 3-in-1.") ch(c);
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => !cs(), "back to reading once it's saved", 8000);
    const reply = (await thread("Which oil")).replies.find(x => !x.tldr)!;
    expect([reply.body, !!reply.edited]).toEqual(["Sewing machine oil: thin, and it doesn't gum. Not 3-in-1.", true]);
    await until(() => rows().some(l => l.includes("└ ") && l.includes("· edited")), "the expanded reply marked edited");
    // An agent's edit through act: saved at once, recorded as the agent; an edit on a revision that's moved on is refused.
    await expect(app.act({ action: "comment.edit", tile: "rota", args: { thread: question.id, body: "Lost words", observed: "Could we swap Thursdays in August?" }, as: "test-agent" })).rejects.toThrow("it changed since you read it");
    expect(await app.act({ action: "comment.edit", tile: "rota", args: { thread: question.id, body: "Could we swap Thursdays in August?", observed: "Could we swap Thursdays in August, from the 4th?" }, as: "test-agent" })).toMatchObject({ sent: "edit" });
    const back = await thread("Could we swap");
    expect(back.body).toBe("Could we swap Thursdays in August?");
    await expect(board.updateComment(question.id, question.revision!, "Lost words")).rejects.toThrow("revision is stale");
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);


  test("margin replies: Recent replies lists an agent's answer on the person's thread (not his note to self), unread until he opens the thread with a click on its card; @margin in a reply there is answered in the same thread; the question and a highlight quoted into one Inbox block (act, then the person's [Quote] and the power bar), each undone in one step", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "margin-replies" }, as: "test-agent" })).toMatchObject({ key: "margin-replies" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "margin-replies")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    await until(() => tiles().find(t => t.name === "replies")?.showing?.id === seeded.notes.recentReplies.id && screen().includes("question · "), "the plan and Recent replies", 8000);
    const plan = seeded.notes.marginalia;
    const thread = (await board.comments(plan.id)).find(t => t.body === "Why ten days, not a week?")!;
    const answer = thread.replies.find(r => r.author !== "user")!;
    const aside = thread.replies.find(r => r.author === "user")!;
    // The saved view: the agent's answer on his thread, not his own note to self.
    const listed = (await board.readSavedView(seeded.notes.recentReplies.id))!.blocks.map(b => b.id);
    expect(listed).toContain(answer.id);
    expect(listed).not.toContain(aside.id);
    // The note to self was never sent: nothing answered it.
    expect(thread.replies.filter(r => r.author !== "user")).toHaveLength(1);
    const unread = async () => (await board.request<{ blocks: { id: string }[] }>("blocks.query", { query: { where: UNREAD_REPLIES_QUERY, limit: 50 } })).blocks.map(b => b.id);
    expect(await unread()).toContain(answer.id);
    // A click on the question's card opens its thread: read now.
    const lines = screen().split("\n");
    const y = lines.findIndex(l => l.includes("question · "));
    const x = lines[y]!.indexOf("question · ");
    press({ kind: "mouse", action: "down", button: 0, x: x + 2, y }); press({ kind: "mouse", action: "up", button: 0, x: x + 2, y });
    const end = Date.now() + 5000;
    while ((await unread()).includes(answer.id)) { if (Date.now() > end) throw new Error("timed out waiting for the thread to be read"); await Bun.sleep(50); }
    // @margin in a reply asks again in the same thread (answered from the note: no model in a test).
    await board.reply("showcase-margin-again", thread.id, "@margin and for the leeks?", { kind: "user" });
    const again = Date.now() + 10_000;
    while (!(await board.comments(plan.id)).find(t => t.id === thread.id)!.replies.some(r => r.author === "ext:marginalia")) {
      if (Date.now() > again) throw new Error("timed out waiting for the margin's answer");
      await Bun.sleep(50);
    }
    // Quote (the margin's quote-tweet): the question and the seeded highlight into one new Inbox block, by an agent through act.
    const highlight = (await board.comments(plan.id)).find(t => !t.body && t.props?.kind?.[0] === "highlight")!;
    const quoted = await app.act({ action: "quote", tile: "plan", args: { threads: `${thread.id},${highlight.id}`, where: "inbox" }, as: "test-agent" }) as { block: string; placed: string; undo: string };
    expect(quoted.placed).toBe("in the Inbox");
    const made = (await board.get(quoted.block))!;
    expect(made.text).toContain(`[from::((${thread.id}))] [from::((${highlight.id}))]`);
    expect(made.text).toContain(`!((${thread.id}))\n!((${highlight.id}))`);
    // Each mark says where it was quoted, and the open thread's panel draws it as a line that opens the new block.
    const marked = await board.comments(plan.id);
    expect(marked.find(t => t.id === thread.id)!.quotedIn).toEqual([quoted.block]);
    expect(marked.find(t => t.id === highlight.id)!.quotedIn).toEqual([quoted.block]);
    await until(() => screen().includes("quoted in Quoting"), "the thread's quoted in line", 5000);
    // One undo step takes it back whole: the block to the Trash, the cards quoted in nothing.
    await app.act({ action: "ext.undo", tile: "plan", as: "test-agent" });
    expect((await board.get(quoted.block).catch(() => null))?.deleted ?? true).toBe(true);
    expect((await board.comments(plan.id)).find(t => t.id === thread.id)!.quotedIn).toBeUndefined();
    // The person's: a click on the thread's [Quote], then the power bar asks where; ⏎ on its first row, the Inbox.
    const quoteAt = () => { const ls = screen().split("\n"), y = ls.findIndex(l => l.includes("[Quote]") && l.includes("[TL;DR]")); return { y, x: y < 0 ? -1 : ls[y]!.indexOf("[Quote]") }; };
    await until(() => quoteAt().y >= 0, "the open thread's [Quote]", 5000);
    const q = quoteAt();
    press({ kind: "mouse", action: "down", button: 0, x: q.x + 2, y: q.y }); press({ kind: "mouse", action: "up", button: 0, x: q.x + 2, y: q.y });
    const asking = () => (app as any).bar?.describe() as { scope: string; rows: { label: string }[] } | undefined;
    await until(() => asking()?.scope === "ask" && asking()!.rows.map(r => r.label).join() === "in the Inbox,under this note", "the power bar asking where", 5000);
    press({ kind: "enter" });
    let mine: string | undefined;
    const by = Date.now() + 5000;
    while (!(mine = (await board.comments(plan.id)).find(t => t.id === thread.id)!.quotedIn?.[0])) { if (Date.now() > by) throw new Error("timed out waiting for the person's quote"); await Bun.sleep(50); }
    expect((await board.get((await board.get(mine))!.parentId!))!.text).toMatch(/^Inbox/);
    // ctrl+z in the reader takes the person's quote back.
    press({ kind: "char", ch: "z", ctrl: true });
    const gone = Date.now() + 5000;
    while ((await board.comments(plan.id)).find(t => t.id === thread.id)!.quotedIn?.length) { if (Date.now() > gone) throw new Error("timed out waiting for ctrl+z to undo the quote"); await Bun.sleep(50); }
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 45_000);
});
