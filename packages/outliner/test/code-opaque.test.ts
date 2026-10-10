// Code is opaque (PIE-764): the service's link index, backlinks, outlinks, embeds, mentions, property parser and
// Detail's completer read no link, property or trigger in a code span or a fence. kitty's request is the fixture.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { OutlinerStore } from "../src/store";
import { readAuthoredLinks } from "../src/authored-links";
import { parsePropertyRecords } from "../src/properties";
import { embedMatches } from "../src/transclusions";
import { extractMentionReferences } from "../src/mentions";
import { completionTargetAtCursor } from "../src/completion";
import { ReferenceCompletionSession, type ReferenceCompletionProvider } from "../src/reference-completion";
import { TextBuffer } from "../src/text-buffer";
import { FENCED_LINKS_NOTE, KITTY_REQUEST_NOTE, STRAY_BACKTICK_NOTE } from "../../outline-core/test/fixtures/code-notes";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function store(): OutlinerStore {
  const directory = mkdtempSync(join(tmpdir(), "outliner-code-opaque-"));
  const result = new OutlinerStore(join(directory, "outliner.sqlite"));
  cleanups.push(() => { result.close(); rmSync(directory, { recursive: true, force: true }); });
  return result;
}

test("kitty's request: its outlinks are the one real link, and the quoted note gets no backlink from it", () => {
  const workspace = store();
  const quoted = workspace.create("Transcript [page::transcript]");
  // The request quotes the forms with a real id too: still text.
  const note = workspace.create(`${KITTY_REQUEST_NOTE}\nAnd \`((${quoted.id}^t0817|at 08:17))\` or \`[[transcript]]\`.`);
  const links = readAuthoredLinks(workspace, note.id);
  if (links.kind !== "ready") throw new Error(links.kind);
  const text = workspace.get(note.id)!.text;
  expect(links.outlinks.entries.map(e => text.slice(e.firstSpan.start, e.firstSpan.end))).toEqual([expect.stringContaining("|meeting notes))")]);
  expect(workspace.queryBacklinks({ targetBlockId: quoted.id, limit: 10 }).sources).toEqual([]);
});

test("a fence holding [[x]], a reference and an embed indexes only the page link after it", () => {
  const workspace = store();
  workspace.create("x [page::x]");
  const garden = workspace.create("Garden [page::Garden]");
  const note = workspace.create(FENCED_LINKS_NOTE);
  const links = readAuthoredLinks(workspace, note.id);
  if (links.kind !== "ready") throw new Error(links.kind);
  expect(links.outlinks.entries.map(e => FENCED_LINKS_NOTE.slice(e.firstSpan.start, e.firstSpan.end))).toEqual(["[[Garden]]"]);
  expect(workspace.queryBacklinks({ targetBlockId: garden.id, limit: 10 }).sources.map(s => s.blockId)).toEqual([note.id]);
  expect(parsePropertyRecords(FENCED_LINKS_NOTE).map(p => p.key)).toEqual(["type"]);
});

test("an unclosed backtick before a property line hides none of its properties", () => {
  expect(parsePropertyRecords(STRAY_BACKTICK_NOTE).map(p => `${p.key}=${p.value}`)).toEqual(["type=annotation", "anchor=passage", "status=open"]);
});

test("an embed in a code span is its text; one outside is an embed", () => {
  const id = "5f0c2a8e-4b1d-4e7a-9c3f-2d6e8b1a7c40";
  expect(embedMatches(`Write \`!((${id}))\` to embed.\n!((${id}))`).map(m => m.index)).toEqual([`Write \`!((${id}))\` to embed.\n`.length]);
});

test("a mention's bare id in code is the code's text", () => {
  const id = "5f0c2a8e-4b1d-4e7a-9c3f-2d6e8b1a7c40";
  expect(extractMentionReferences(`An example: \`((${id}))\` and \`${id}\``)).toEqual([]);
  expect(extractMentionReferences(`See ${id}`).map(r => r.value)).toEqual([id]);
});

test("Detail's completer opens no popup inside backticks, a span being typed or a fence", async () => {
  expect(completionTargetAtCursor("See `[[Gar", 10, ["See `[[Gar"], 0)).toBeNull();
  expect(completionTargetAtCursor("See `x` [[Gar", 13, ["See `x` [[Gar"], 0)).toMatchObject({ kind: "page", query: "Gar" });
  let asked = 0;
  const provider: ReferenceCompletionProvider = {
    queryBlocks: async () => ({ blocks: [], completeness: { kind: "complete" } }),
    queryPageAddresses: async q => { asked++; return { addresses: [{ address: q || "home", normalizedAddress: q || "home", blockId: "home", kind: "page", title: "home" }], completeness: { kind: "complete" } }; },
    completeFiles: async () => [], readContext: async () => null as never, updateBlock: async () => null as never,
  };
  for (const [text, opens] of [["Title\n```\n[[Gar", false], ["Title\nquote `((ab", false], ["Title\n`code` [[Gar", true]] as const) {
    const buffer = new TextBuffer(text), lines = text.split("\n");
    buffer.placeCursor(lines.length - 1, lines.at(-1)!.length);
    const session = new ReferenceCompletionSession(provider, () => buffer, () => null, () => {}, () => true);
    await session.refresh();
    expect(session.state !== null).toBe(opens);
  }
  expect(asked).toBe(1);
});
