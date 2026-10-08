// PIE-650: C on text selected in a reader showing a Resource. The reader draws Markdown; the quote the service stores
// is the file's own source, and its offset is the file's. No service: the board is a stub, and the real
// SocketBoard.commentOnResource shapes the request. Fictional file.
import { describe, expect, test } from "bun:test";
import { alignComments, resourceNote, type ResourceDescription } from "../src/authored";
import type { Msg } from "../src/board";
import { SocketBoard } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");

const RAW = "# Rollout notes\n\nThe **cache** warms [on boot](https://example.test/boot), then _slowly_ fills.\n\n- step one\n- step two: `warm()`\n\nSee the plan.\n";
const description = (over: Partial<ResourceDescription> = {}): ResourceDescription => ({
  resource: { id: "res-1", provider: "filesystem", mediaType: "text/markdown", address: { kind: "filesystem", path: "/work/garden/pr-body.md" }, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
  source: { id: "src-1", name: "Filesystem · garden", provider: "filesystem" },
  filesystem: { text: RAW, capturedAt: "2026-10-01T00:00:00Z", contentHash: "0123456789abcdef".repeat(4) },
  ...over,
});

describe("a Resource shown as a note", () => {
  test("a Markdown file: drawn as it is, its text starting after the header, named by the revision of its text", () => {
    const m = resourceNote(description(), "host-note");
    expect(m.resource).toMatchObject({ id: "res-1", from: "host-note", sourceAt: m.text.indexOf(RAW) });
    expect(m.text.slice(m.resource!.sourceAt!)).toBe(RAW);
    expect(m.resource!.uncommentable).toBeUndefined();
    expect(m.revision).toBe(0x0123456789ab);
  });

  test("another text file is drawn in a fence: the offset is after the fence's opening line", () => {
    const raw = "water: 3\nseeds: 12\n";
    const m = resourceNote(description({ resource: { ...description().resource, address: { kind: "filesystem", path: "/work/garden/seed-list.txt" } }, filesystem: { text: raw, capturedAt: "2026-10-01T00:00:00Z", contentHash: "ab".repeat(32) } }));
    expect(m.text.slice(m.resource!.sourceAt!, m.resource!.sourceAt! + raw.length)).toBe(raw);
  });

  test("text the reader changes to draw it (tabs) has no place: the quote goes without an offset", () => {
    const m = resourceNote(description({ filesystem: { text: "a\tb\n", capturedAt: "2026-10-01T00:00:00Z", contentHash: "cd".repeat(32) } }));
    expect(m.resource!.sourceAt).toBeNull();
    expect(m.revision).toBeDefined();
  });

  test("a ticket, a binary file, a missing file and a PDF say why they can't be quoted", () => {
    const base = description();
    const ticket = resourceNote({ ...base, filesystem: null, remoteEntity: { title: "Fix the gate", markdown: "# x\n\nbody", externalUrl: "", metadata: {} } });
    expect(ticket.resource!.uncommentable).toContain("ticket");
    expect(ticket.revision).toBeUndefined();
    expect(resourceNote({ ...base, filesystem: { text: "a\0b", capturedAt: "x", contentHash: "ee".repeat(32) } }).resource!.uncommentable).toContain("binary");
    expect(resourceNote({ ...base, filesystem: null }).resource!.uncommentable).toContain("can't be read");
    expect(resourceNote({ ...base, filesystem: null, pdf: {} }).resource!.uncommentable).toContain("PDF");
    expect(resourceNote({ ...base, filesystem: { text: RAW, capturedAt: "x" } }).resource!.uncommentable).toContain("didn't say which version");
  });

  test("threads are placed where the text is drawn, and a text drawn differently places none", () => {
    const m = resourceNote(description());
    const c: { start: number | null; end: number | null } = { start: 3, end: 9 };
    expect(alignComments([c], m)).toEqual([{ start: 3 + m.resource!.sourceAt!, end: 9 + m.resource!.sourceAt! }]);
    expect(alignComments([c], { ...m, resource: { ...m.resource!, sourceAt: null } })).toEqual([{ start: null, end: null }]);
    expect(alignComments([c], { id: "x" } as Msg)).toEqual([c]);
  });
});

describe("a Resource's threads, read against the text that was drawn", () => {
  const thread = { block: { id: "t1", actorId: "me" }, body: "Why?", lifecycle: "open", originalTarget: { anchor: { exact: "cache" }, representation: { subject: { kind: "resource" } } }, resolvedTarget: { anchor: { kind: "text-quote", start: 4, end: 9 } }, replies: [] };
  const boardAnswering = (revision: number) => {
    const board = Object.create(SocketBoard.prototype) as SocketBoard;
    (board as any).request = async () => ({ threads: [thread], changed: false, revision });
    return board;
  };

  test("offsets mean the text they were placed in: the same text keeps its places", async () => {
    let stale = false;
    const c = await boardAnswering(7).comments("resource:res-1", { revision: 7, stale: () => { stale = true; } });
    expect(c.map(x => [x.start, x.end])).toEqual([[4, 9]]);
    expect(stale).toBe(false);
  });

  test("a file that changed since it was drawn: no places for its quotes, and the reader is told to read again", async () => {
    let stale = false;
    const c = await boardAnswering(8).comments("resource:res-1", { revision: 7, stale: () => { stale = true; } });
    expect(c.map(x => [x.quote, x.start, x.end])).toEqual([["cache", null, null]]);
    expect(stale).toBe(true);
  });
});

describe("C on a selection in a Resource, against the source", () => {
  const setup = () => {
    const note = resourceNote(description(), "host-note");
    const sent: any[] = [];
    // The real board's shaping of the request, over a stub socket.
    const board = Object.create(SocketBoard.prototype) as SocketBoard;
    (board as any).request = async (action: string, body: any) => { sent.push({ action, body }); return { annotations: [{ block: { id: "thread-1" } }], deduplicated: false }; };
    const host: SurfaceHost = {
      ctx: { board: { ancestors: async () => [], comments: async () => [], get: async () => note }, flash() {}, copy() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any,
      redraw() {}, navigate() {},
    };
    const s = new NoteSurface();
    s.show(note, host);
    const draw = () => s.render(70, 24, host).lines;
    const at = (text: string) => { const lines = draw(), y = lines.findIndex(l => plain(l).includes(text)); if (y < 0) throw new Error(`${text} isn't drawn`); return { x: plain(lines[y]!).indexOf(text), y }; };
    const select = (from: string, to: string) => { const a = at(from), z = at(to); s.press(a.x, a.y, host); s.drag(z.x + to.length - 1, z.y, host); s.release(z.x + to.length - 1, z.y, host); };
    /** C on what is selected, then the request the comment becomes. */
    const comment = async () => {
      s.key(char("C"), host);
      for (let i = 0; i < 100 && !s.session; i++) await Bun.sleep(5);
      const session = s.session!;
      const passage = session.passage!.passage;
      const sourceAt = note.resource!.sourceAt!;
      expect(note.text.slice(passage.start, passage.start + passage.quote.length)).toBe(passage.quote);
      await board.commentOnResource("req-1", note.resource!, note.revision!, "A question", passage);
      const op = sent.at(-1).body.operations[0];
      // Whatever the rendered view showed, the request quotes the file: its offset is the file's own.
      expect(RAW.slice(op.input.passage.start, op.input.passage.start + op.input.passage.quote.length)).toBe(op.input.passage.quote);
      expect(op.input.passage.start).toBe(passage.start - sourceAt);
      return op;
    };
    return { s, note, select, comment, sent };
  };

  test("a heading: the words selected are the source's words after the #", async () => {
    const { select, comment } = setup();
    select("Rollout notes", "Rollout notes");
    const op = await comment();
    expect(op).toMatchObject({ type: "resource-comment", input: { resourceId: "res-1", referenceBlockId: "host-note", source: "user" } });
    expect(op.input.passage.quote).toBe("Rollout notes");
    expect(op.input.passage.start).toBe(RAW.indexOf("Rollout notes"));
  });

  test("emphasis and a link: the selection that crosses the markup quotes the source line, markup and all", async () => {
    const { select, comment } = setup();
    select("cache", "on boot");
    const op = await comment();
    expect(op.input.passage.quote).toContain("**cache** warms [on boot](https://example.test/boot)");
    expect(op.input.passage.start).toBe(RAW.indexOf("The **cache**"));
  });

  test("a list item and plain words inside one line", async () => {
    const { select, comment } = setup();
    select("step one", "step one");
    expect((await comment()).input.passage).toMatchObject({ quote: "step one", start: RAW.indexOf("step one") });
  });
});
