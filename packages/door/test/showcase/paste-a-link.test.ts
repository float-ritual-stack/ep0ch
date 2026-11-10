// PIE-1401 / PIE-1316 / PIE-1390 / PIE-1659: the showcase's "Paste a link" section. A note's web link and its ep0ch:// address pasted
// bare are links that open the note; what copy note web link and copy line reference give, pasted by the person into the
// note and saved, opens it too; another web page goes to the browser. One of the showcase's test files; the seed is made up.
import { beforeAll, describe, expect, test } from "bun:test";
import { USER } from "../../src/socket";
import { external } from "../../src/open";
import { traceActions } from "../../src/surface/actions";
import { outliner, until, untilAsync } from "../scratch";
import { useShowcaseScreen } from "./harness";

const AGENT = { kind: "agent", id: "paste-tester" } as never;

describe.skipIf(!outliner)("the showcase screen: paste a link", () => {
  const h = useShowcaseScreen();
  const { screen } = h;
  let board!: typeof h.board, app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(async () => {
    ({ board, app, seeded } = h);
    await app.dispatch.act({ action: "section", args: { name: "paste-a-link" } }, USER);
    await until(() => screen().includes("allotment-rules"), "the section's note");
  });
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string, who = USER as never) => app.dispatch.act({ action, args, ...(tile ? { tile } : {}) }, who) as Promise<any>;
  const desk = () => h.S().stages.get(h.S().sel).top;
  const notes = () => desk().pane("notes") as any;
  /** The notes reader's links, in the order link.follow's n= counts them. */
  const elements = async () => ((await act("elements", {}, "notes", AGENT)).elements as { n: number; kind: string; label: string }[]).filter(e => e.kind === "link");
  const readers = () => [...desk().panes.values()].filter((p: any) => p.kind === "reader") as any[];
  /** Follow link `n` of the notes reader as the person: the rota opens where the door lands a reader's open. */
  const followN = async (n: number, what: string) => {
    expect(n).toBeGreaterThan(0);
    const preview = desk().pane("preview") as any;
    preview.show((await board.get(seeded.notes.root.id))!, desk());
    await until(() => !readers().some(p => p.msg?.id === seeded.notes.keyRota.id), "no reader on the rota");
    const r = await act("link.follow", { n }, "notes");
    expect({ what, opened: r.opened }).toEqual({ what, opened: seeded.notes.keyRota.id });
    await until(() => readers().some(p => p.msg?.id === seeded.notes.keyRota.id), `${what} opened the rota`, 8000);
    // As this outline's own note, not another outline's (its address names this outline).
    expect(readers().find(p => p.msg?.id === seeded.notes.keyRota.id)!.msg.address).toBeUndefined();
    // Followed in place: the notes reader goes back to the note to paste into, as ⌫ does.
    if (notes().msg?.id !== seeded.notes.pasteALink.id) {
      notes().hold((await board.get(seeded.notes.pasteALink.id))!, desk());
      await until(() => notes().msg?.id === seeded.notes.pasteALink.id, "back on the note to paste into");
    }
  };
  const follow = async (url: string) => {
    await untilAsync(async () => (await elements()).some(e => e.label.includes(url)), `${url} drawn as a link`, 8000);
    await followN((await elements()).findIndex(e => e.label.includes(url)) + 1, url);
  };

  test("the seeded web link and ep0ch:// address are links that open the rota; another web page opens the browser", async () => {
    const m = (await board.get(seeded.notes.pasteALink.id))!;
    const link = m.text.match(/web link: (\S+)/)![1]!, uri = m.text.match(/address: (\S+)/)![1]!;
    expect(uri).toBe(`ep0ch://${(await board.info()).outline}@${(await board.info()).machine}/b/${seeded.notes.keyRota.id}`);
    // Drawn as written (not hidden like a Markdown link's destination).
    expect(screen()).toContain(uri.slice(0, 40));
    await follow(link);
    await follow(uri);
    const run = external.run, ran: string[][] = [];
    external.run = cmd => { ran.push(cmd); };
    try {
      await untilAsync(async () => (await elements()).some(e => e.label.includes("example.org/allotment-rules")), "the web page's link");
      const n = (await elements()).findIndex(e => e.label.includes("example.org/allotment-rules")) + 1;
      await act("link.follow", { n }, "notes");
      await until(() => ran.length > 0 || String((app as any).message).includes("allotment-rules"), "the web page sent outside");
      expect(notes().msg?.id).toBe(seeded.notes.pasteALink.id);
    } finally { external.run = run; }
  }, 30_000);

  test("copy note web link and copy line reference from the rota, pasted by the person and saved: each opens the rota", async () => {
    (desk().pane("preview") as any).show((await board.get(seeded.notes.keyRota.id))!, desk());
    await until(() => desk().pane("preview").msg?.id === seeded.notes.keyRota.id, "the preview on the rota");
    // What the rota's menu copies, through act (an agent's copy comes back to it, the clipboard untouched).
    const link = (await act("note.copy-ref", { kind: "link" }, "preview", AGENT)).text as string;
    const line = await act("note.copy-ref", { kind: "line", line: 4 }, "preview", AGENT);
    expect(line.text).toMatch(new RegExp(`^\\(\\(${seeded.notes.keyRota.id}\\^${line.anchor}\\|Ana opens at nine and waters the seedlings\\.\\)\\)$`));
    expect(line.created).toBe(true);
    // The links tile lists the rota (the reference's outlink): its selected row copies the same web link (a list row is a note).
    await untilAsync(async () => (await act("note.copy-ref", { kind: "id" }, "links", AGENT).catch(() => null))?.text === seeded.notes.keyRota.id, "the links tile on the rota's row");
    expect((await act("note.copy-ref", { kind: "link" }, "links", AGENT)).text).toBe(link);
    // The person pastes the web link bare on the Paste here line, and saves.
    await act("tile.focus", {}, "notes");
    h.press({ kind: "enter" });
    await until(() => h.S().focus === "stage", "in the stage");
    h.ch("e"); h.press({ kind: "enter" });
    await until(() => !!notes().draft, "the note in an edit");
    const d = notes().draft;
    d.row = d.lines.findIndex((l: string) => l.startsWith("- Paste here:")); d.col = d.lines[d.row].length;
    h.press({ kind: "paste", text: ` ${link}` });
    h.press({ kind: "char", ch: "s", ctrl: true });
    await untilAsync(async () => (await board.get(seeded.notes.pasteALink.id))!.text.includes(`- Paste here: ${link}`), "the paste saved", 8000);
    await until(() => !notes().surface.editing, "the edit closed");
    // The note says the link twice now (seeded and pasted): the pasted one is the last, and opens the rota too.
    await followN((await elements()).map((e, i) => (e.label.includes(link) ? i + 1 : 0)).filter(Boolean).at(-1)!, "the pasted web link");
    // A line's reference pasted (an agent's write this time): it opens the rota.
    const m = (await board.get(seeded.notes.pasteALink.id))!;
    await board.update(m.id, `${m.text}\n- And the line: ${line.text}`, m.revision!);
    await until(() => (notes().msg?.text ?? "").includes(line.anchor), "the line reference in the reader");
    await untilAsync(async () => (await elements()).some(e => e.label.includes("Ana opens")), "the line reference drawn", 8000);
    await followN((await elements()).findIndex(e => e.label.includes("Ana opens")) + 1, "the line reference");
    for (let i = 0; i < 4 && h.S().focus === "stage"; i++) h.press({ kind: "esc" });
  }, 40_000);

  // PIE-1659: any other text pasted where nothing is typed into is offered in the power bar; none of its letters runs.
  test("plain text pasted on the note with no edit open: the power bar offers it, and no letter runs as a key", async () => {
    await act("tile.focus", {}, "notes");
    h.press({ kind: "enter" });
    await until(() => h.S().focus === "stage", "in the stage");
    const before = (await board.get(seeded.notes.pasteALink.id))!, tiles = (desk().layoutGet().tiles as any[]).map(t => t.name);
    const ran: string[] = [];
    const stop = traceActions(r => ran.push(r.name));
    try {
      h.press({ kind: "paste", text: "dd the shed key\nx Ana opens at nine" });
      await until(() => (app.describe() as any).bar?.query === "dd the shed key x Ana opens at nine", "the power bar offers the paste, its line break a space", 3000);
    } finally { stop(); }
    expect(ran.filter(n => !n.startsWith("bar.") && n !== "screen.list")).toEqual([]);
    h.press({ kind: "esc" });
    const after = (await board.get(seeded.notes.pasteALink.id))!;
    expect({ revision: after.revision, trashed: !!(after as any).effectiveDeletedRootId }).toEqual({ revision: before.revision, trashed: false });
    expect((desk().layoutGet().tiles as any[]).map(t => t.name)).toEqual(tiles);
    for (let i = 0; i < 4 && h.S().focus === "stage"; i++) h.press({ kind: "esc" });
  }, 30_000);

  // PIE-1316: every row that is a note copies it through its own tile's menu: the tree's selected row too, with no ref=.
  test("the tree's selected row copies its note's web link, the service's answer", async () => {
    await app.dispatch.act({ action: "section", args: { name: "entity" } }, USER);
    let r: any = null;
    await untilAsync(async () => !!(r = await act("note.copy-ref", { kind: "id" }, "tree", AGENT).catch(() => null)), "the tree on a row", 8000);
    const link = (await act("note.copy-ref", { kind: "link" }, "tree", AGENT)).text as string;
    expect(link).toMatch(new RegExp(`/pub/o/${(await board.info()).outline}/p/[^/]+$`));
    expect(link.endsWith(`/p/${r.text}`) || /\/p\/[A-Z]+-\d+$/.test(link)).toBe(true);
    await app.dispatch.act({ action: "section", args: { name: "paste-a-link" } }, USER);
  }, 30_000);
});
