// Embeds as elements, and an agent's proposal (PIE-501) usable by keys, mouse and act: every embed kind
// (a note, a fragment, a view, a proposal) is a [ ] stop and a click on its source line selects it; a proposal's
// source line, and an opened proposal's header, carry [apply] and [dismiss], which run proposal.apply and
// proposal.dismiss, as A and X do. Runs against a scratch outliner service with fictional notes, never a real
// outline.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Msg } from "../src/board";
import { SocketBoard, type Actor } from "../src/socket";
import { visible } from "../src/style";
import { NoteSurface, NOTE_ACTIONS, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const TIDY: Actor = { kind: "agent", id: "tidy" };
const OTHER: Actor = { kind: "agent", id: "sweep" };
const W = 90, H = 70;

describe.skipIf(!outliner)("embeds and proposals in a reader, on a scratch service", () => {
  const scratch = new Scratch();
  let board: SocketBoard, agent: SocketBoard;
  const flashes: string[] = [];
  const opened: Msg[] = [];
  const host = (): SurfaceHost => ({
    ctx: { board, flash: (m: string) => flashes.push(m), t: { cellW: 9, cellH: 16 }, graphics: false } as any,
    redraw() {}, navigate(m: Msg) { opened.push(m); },
  });
  const create = async (text: string, parentId: string | null = null) => (await board.request<any>("create", { parentId, text, author: "user" })).id as string;
  let shed = "", beds = "", view = "";

  /**
   * A note embedding a note, a fragment and a view, and a proposal tidy's patch left beside it: the person
   * retitled the note after tidy read it, so the patch couldn't apply and became a proposal (PIE-725: drawn after the
   * note's last line, where its embed line used to go, without a word of the note changed). With
   * `gone`, the person reworded the very sentence instead: the proposal can't be applied, only dismissed.
   */
  async function proposed(gone = false) {
    flashes.length = 0;
    const id = await create(`Weekend plan\nThe peas   climb  the net.\n\n!((${shed}))\n\n!((${beds}^north))\n\n!((${view}))\n`);
    const read = (await board.get(id))!;
    const observed = "The peas   climb  the net.", start = read.text.indexOf(observed);
    await board.update(id, gone ? read.text.replace(observed, "The peas sugar   climb  the net.") : read.text.replace(observed, `${observed} Mind the slugs.`), read.revision!);
    const r = await agent.request<any>("draft.patch", {
      blockId: id, revision: read.revision, mutation: { author: "agent", actorId: "tidy" },
      patches: [{ observed, replacement: "The peas climb the net.", range: { start, end: start + observed.length }, unit: "utf16", before: read.text.slice(0, start), after: read.text.slice(start + observed.length, start + observed.length + 48) }],
    });
    expect(r).toMatchObject({ outcome: "proposed", beside: id });
    expect((await board.get(id))!.text).not.toContain(r.proposalId);
    return { id, proposal: r.proposalId as string };
  }

  /** A reader on note `id`, drawn once every embed in it is projected. */
  async function reading(id: string) {
    const s = new NoteSurface(), h = host();
    s.show((await board.get(id))!, h);
    const frame = () => s.render(W, H, h).lines.map(visible);
    await until(() => { frame(); return s.describeElements().filter(e => e.kind === "embed").length === 4 && s.describeElements().some(e => e.control === "dismiss"); }, "every embed drawn", 10_000);
    return { s, h, frame };
  }

  /** Where `text` is drawn in the last frame, as a click's cell. */
  const at = (lines: string[], text: string) => {
    const y = lines.findIndex(l => l.toLowerCase().includes(text.toLowerCase()));
    expect(y).toBeGreaterThanOrEqual(0);
    return { x: lines[y]!.toLowerCase().indexOf(text.toLowerCase()) + 1, y };
  };
  /** The change feed's last entry for a block: what was done, and who it records. */
  const lastChange = async (blockId: string) => ((await board.changesSince(0, 1000)) as any).changes.filter((c: any) => c.blockId === blockId).at(-1);
  const current = (s: NoteSurface) => s.describeElements().find(e => e.current);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    board.subscribe(() => {});
    agent = new SocketBoard(scratch.sock);
    await agent.info();
    shed = await create("Paint the shed\nTwo coats, green.");
    beds = await create("Bed notes\n- dig the north bed ^north\n  - edge it with boards");
    await create("Sow the beans [type::garden-job]");
    const hub = await create("Garden board");
    view = await create("Jobs [type::virtual-branch] [query::type=garden-job]", hub);
  }, 30_000);
  afterAll(async () => { board?.close(); agent?.close(); await scratch.dispose(); }, 20_000);

  test("] reaches every embed kind, and a proposal's [apply] [dismiss] after its source line", async () => {
    const { id, proposal } = await proposed();
    const { s, h, frame } = await reading(id);
    const seen: string[] = [];
    // The proposal's title is the service's words ("Proposed edit from @tidy…", or "1 proposed edit from @tidy…").
    const named = (e: { kind: string; label: string }) => `${e.kind} ${/proposed edit/i.test(e.label) ? "» a proposal by @tidy" : e.label.slice(0, 26)}`;
    for (let i = 0; i < s.describeElements().length; i++) { s.key(char("]"), h); frame(); seen.push(named(current(s)!)); }
    expect(seen).toEqual([
      "embed » Paint the shed",
      "embed » Bed notes ^north",
      "embed ≡ Jobs · 1 result",
      "row Sow the beans",
      "embed » a proposal by @tidy",
      "control [apply]",
      "control [dismiss]",
      "link Weekend plan",
    ]);
    expect(s.describeElements().filter(e => e.control).map(e => [e.control, e.proposal])).toEqual([["apply", proposal], ["dismiss", proposal]]);
    // On the proposal's source line the hint leads with its keys.
    s.key(char("["), h); s.key(char("["), h); s.key(char("["), h); frame();
    expect(current(s)).toMatchObject({ kind: "embed", target: proposal });
    expect(s.hint()).toContain("A apply anyway · X dismiss");
  }, 30_000);

  test("a click on each embed's source line selects it and opens it", async () => {
    const { id, proposal } = await proposed();
    const { s, h, frame } = await reading(id);
    for (const [label, target] of [["» Paint the shed", shed], ["» Bed notes ^north", beds], ["≡ Jobs", view], ["proposed edit from @tidy", proposal]] as const) {
      const lines = frame(), p = at(lines, label);
      opened.length = 0;
      expect(s.click(p.x + 2, p.y, h)).toBe(true);
      frame();
      expect(current(s)).toMatchObject({ kind: "embed", target });
      await until(() => opened.length > 0, `${label} opened`);
      expect(opened[0]!.id).toBe(target);
    }
  }, 30_000);

  test("A on a proposal's embed applies it anyway", async () => {
    const { id, proposal } = await proposed();
    const { s, h, frame } = await reading(id);
    while (current(s)?.target !== proposal) { s.key(char("]"), h); frame(); }
    expect(s.key(char("A"), h)).toBe(true);
    await until(() => !!flashes.at(-1)?.startsWith("applied the proposal"), "the apply");
    expect((await board.get(proposal))!.props["proposal-status"]).toBe("applied");
    expect((await board.get(id))!.text).toContain("The peas climb the net.");
  }, 30_000);

  test("a click on [apply] applies it; then its controls are gone", async () => {
    const { id, proposal } = await proposed();
    const { s, h, frame } = await reading(id);
    const p = at(frame(), "[apply]");
    expect(s.click(p.x + 1, p.y, h)).toBe(true);
    await until(() => !!flashes.at(-1)?.startsWith("applied the proposal"), "the apply");
    expect((await board.get(proposal))!.props["proposal-status"]).toBe("applied");
    expect((await board.get(id))!.text).toContain("The peas climb the net.");
    await until(() => { frame(); return !s.describeElements().some(e => e.control); }, "the controls gone once it's applied", 10_000);
  }, 30_000);

  test("a click on [dismiss] trashes the proposal and takes its embed line out of the note, as the person", async () => {
    const { id, proposal } = await proposed();
    const { s, h, frame } = await reading(id);
    const p = at(frame(), "[dismiss]");
    expect(s.click(p.x + 1, p.y, h)).toBe(true);
    await until(() => !!flashes.at(-1)?.startsWith("dismissed the proposal"), "the dismiss");
    expect((await board.get(proposal))!.deleted).toBe(true);
    const note = (await board.get(id))!;
    expect(note.text).not.toContain(`!((${proposal}))`);
    expect(note.text).toContain("The peas   climb  the net.");                         // nothing applied
    expect(await lastChange(id)).toMatchObject({ kind: "edit", actor: { author: "user" } });
    expect(await lastChange(proposal)).toMatchObject({ kind: "delete", actor: { author: "user" } });
  }, 30_000);

  test("X on a proposal's embed dismisses it", async () => {
    const { id, proposal } = await proposed();
    const { s, h, frame } = await reading(id);
    while (current(s)?.target !== proposal) { s.key(char("]"), h); frame(); }
    expect(s.key(char("X"), h)).toBe(true);
    await until(() => !!flashes.at(-1)?.startsWith("dismissed the proposal"), "the dismiss");
    expect((await board.get(proposal))!.deleted).toBe(true);
    expect((await board.get(id))!.text).not.toContain(`!((${proposal}))`);
  }, 30_000);

  test("an agent dismisses only its own proposal, attributed; another agent is refused", async () => {
    const { id, proposal } = await proposed();
    const { s, h } = await reading(id);
    await expect(s.act("proposal.dismiss", { id: proposal }, h, OTHER)).rejects.toThrow("an agent dismisses only its own");
    expect((await board.get(proposal))!.deleted).toBeFalsy();
    const r = await s.act("proposal.dismiss", { id: proposal }, h, TIDY);
    // Nothing to take out of the note: the proposal was beside it (PIE-725), and the note's last change is the person's.
    expect(r).toMatchObject({ outcome: "dismissed", proposalId: proposal, embedRemoved: null });
    expect((await board.get(proposal))!.deleted).toBe(true);
    expect(flashes.at(-1)).toContain("an agent (tidy) · dismissed the proposal");
    expect(await lastChange(id)).toMatchObject({ kind: "edit", actor: { author: "user" } });
    expect(await lastChange(proposal)).toMatchObject({ kind: "delete", actor: { author: "agent", actorId: "tidy" } });
  }, 30_000);

  test("an agent's element.open on [dismiss] runs the dismissal as that agent", async () => {
    const { id, proposal } = await proposed();
    const { s, h } = await reading(id);
    const n = s.describeElements().find(e => e.control === "dismiss")!.n;
    await expect(NOTE_ACTIONS.run("element.open", { n }, { surface: s, host: h }, OTHER)).rejects.toThrow("only its own");
    await NOTE_ACTIONS.run("element.open", { n }, { surface: s, host: h }, TIDY);
    expect((await board.get(proposal))!.deleted).toBe(true);
    expect(current(s)).toBeUndefined();                                                   // the person's [ ] stays theirs
  }, 30_000);

  test("an opened proposal has [apply] [dismiss] in its header, by click and keys", async () => {
    const { id, proposal } = await proposed();
    const s = new NoteSurface(), h = host();
    s.show((await board.get(proposal))!, h);
    const lines = s.render(W, H, h).lines.map(visible);
    expect(lines.slice(0, 6).join("\n")).toContain("proposal · [apply] [dismiss]");
    expect(s.hint()).toContain("A apply anyway · X dismiss");
    const p = at(lines, "[apply]");
    expect(s.click(p.x + 1, p.y, h)).toBe(true);
    await until(() => !!flashes.at(-1)?.startsWith("applied the proposal"), "the apply");
    expect((await board.get(id))!.text).toContain("The peas climb the net.");
  }, 30_000);

  test("A on an ordinary embed isn't taken: it's apply anyway only on a proposal (PIE-510)", async () => {
    const { id } = await proposed();
    const { s, h, frame } = await reading(id);
    while (current(s)?.target !== shed) { s.key(char("]"), h); frame(); }
    flashes.length = 0;
    expect(s.key(char("A"), h)).toBe(false);
    await Bun.sleep(100);
    expect(flashes.filter(f => /draft proposal|isn't a proposal/.test(f))).toEqual([]);
    expect(s.hint()).not.toContain("apply anyway");
  }, 30_000);

  test("a proposal whose passage was already gone offers only [dismiss]: A says why, a click on [dismiss] dismisses it", async () => {
    const { id, proposal } = await proposed(true);
    expect((await board.get(proposal))!.props["proposal-applies"]).toBe("no");
    const { s, h, frame } = await reading(id);
    const lines = frame();
    expect(lines.join("\n")).not.toContain("[apply]");
    expect(s.describeElements().filter(e => e.control).map(e => e.control)).toEqual(["dismiss"]);
    while (current(s)?.target !== proposal) { s.key(char("]"), h); frame(); }
    expect(s.hint()).toContain("X dismiss");
    expect(s.hint()).not.toContain("A apply");
    expect(s.key(char("A"), h)).toBe(true);
    await until(() => flashes.some(f => f.includes("can't be applied")), "A's refusal");
    await expect(NOTE_ACTIONS.run("proposal.apply", { id: proposal }, { surface: s, host: h }, TIDY)).rejects.toThrow("can't be applied");
    expect((await board.get(proposal))!.props["proposal-status"]).toBe("open");
    const p = at(frame(), "[dismiss]");
    expect(s.click(p.x + 1, p.y, h)).toBe(true);
    await until(() => !!flashes.at(-1)?.startsWith("dismissed the proposal"), "the dismiss");
    expect((await board.get(proposal))!).toMatchObject({ deleted: true, props: { "proposal-status": "dismissed" } });
    expect((await board.get(id))!.text).not.toContain(`!((${proposal}))`);
    // Opened, it says so in its header too.
    const opened = new NoteSurface();
    opened.show((await board.get(proposal))!, h);
    expect(opened.render(W, H, h).lines.map(visible).join("\n")).not.toContain("[dismiss]");   // dismissed: no controls left
  }, 30_000);

  test("an opened proposal that can't be applied has only [dismiss] in its header", async () => {
    const { proposal } = await proposed(true);
    const s = new NoteSurface(), h = host();
    s.show((await board.get(proposal))!, h);
    const head = s.render(W, H, h).lines.map(visible).slice(0, 8).join("\n");
    expect(head).toContain("proposal · [dismiss]");
    expect(head).toContain("it can't be applied");
    expect(head).not.toContain("[apply]");
  }, 30_000);

  test("the [ ] position stays on the proposal while an agent rewrites the note around it", async () => {
    const { id, proposal } = await proposed();
    const { s, h, frame } = await reading(id);
    while (current(s)?.target !== proposal) { s.key(char("]"), h); frame(); }
    for (let i = 0; i < 3; i++) {
      const m = (await board.get(id))!;
      await agent.update(id, `${m.text.trimEnd()}\n- status tick ${i}`, m.revision!, TIDY);
      s.refresh((await board.get(id))!);
      frame(); await Bun.sleep(30); frame();
      expect(current(s)).toMatchObject({ kind: "embed", target: proposal });
    }
    expect(s.key(char("A"), h)).toBe(true);
    await until(() => !!flashes.at(-1)?.startsWith("applied the proposal"), "the apply");
  }, 30_000);
});
