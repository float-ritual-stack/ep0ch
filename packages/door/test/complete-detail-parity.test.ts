// Components, properties and callout types complete through the service (PIE-1344): the door's completer and Detail's
// ask the same `completion.rows` on one scratch host and list the same rows, and a component chosen in Detail writes
// all its lines with its first value selected.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { completionTargetAtCursor } from "@ep0ch/outline-core/completion-triggers";
import { SocketBoard } from "../src/socket";
import { lookupCompletion } from "../src/surface/completer";
import { outliner, Scratch } from "./scratch";

// Detail's own completion and editor buffer, loaded by path: the door's type check holds its own sources, not the
// outliner's (whose compiler settings differ), so these are typed here by what the test calls.
const DETAIL = "../../outliner/src/reference-completion", BUFFER = "../../outliner/src/text-buffer";
type Item = { id?: string; insertion: string; selection?: { start: number; end: number } };
type Buffer = { text: string; lines: string[]; selectedText: string | null; placeCursor(row: number, column: number): void };
const { lookupReferenceCompletion, referenceCompletionProvider, ReferenceCompletionSession } = await import(DETAIL) as {
  lookupReferenceCompletion(provider: unknown, target: unknown, draft?: unknown): Promise<{ items: Item[] }>;
  referenceCompletionProvider(client: unknown, actorId: string): unknown;
  ReferenceCompletionSession: new (provider: unknown, buffer: () => Buffer, changed: () => void, active: () => boolean, draft: () => unknown) => { state: { items: Item[] } | null; refresh(): Promise<void>; accept(index: number): Promise<boolean> };
};
const { TextBuffer } = await import(BUFFER) as { TextBuffer: new (text: string) => Buffer };

describe.skipIf(!outliner)("one set of rows for :: [key [key:: and > [! (PIE-1344)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, draftId = "";
  // Detail's client, over the same host: the outliner's requester shape on the door's socket.
  const detail = () => referenceCompletionProvider({ request: ({ action, ...input }: { action: string } & Record<string, unknown>) => board.request(action, input) }, "user:made-up");
  const create = async (text: string) => (await board.request("create", { parentId: null, text, author: "agent" })).id as string;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    await create("Greenhouse log [season::spring] [crop::beans]");
    await create("Shed list [season::autumn] [crop::leeks]");
    await create("Recipe type [callout-type::recipe] [callout-icon::♨] [callout-tone::green]");
    draftId = await create("Planting notes [crop::kale]");
  });
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  for (const line of ["::gr", "::", "[se", "[crop::", "[crop::b", "> [!re", "> [!"]) {
    test(`${JSON.stringify(line)}: the door and Detail list the same rows`, async () => {
      const target = completionTargetAtCursor(line, line.length)!;
      expect(target).not.toBeNull();
      const draft = { blockId: draftId, text: `Planting notes [crop::kale]\n${line}` };
      const [door, mine] = await Promise.all([
        lookupCompletion(board, target, draft, { near: draftId }),
        lookupReferenceCompletion(detail(), target, draft),
      ]);
      expect(door.items.length).toBeGreaterThan(0);
      expect(mine.items.map(i => i.insertion)).toEqual(door.items.map(i => i.insertion));
    });
  }

  // A figure's values and a component's attributes (PIE-1366): the service answers them too, so Detail offers what the door does.
  const FIGURE = ["Planting notes [crop::kale]", "::graph-tabs", "---", "query: type=roadmap-item"];
  for (const lines of [[...FIGURE, "density: c"], [...FIGURE, "density: "], [...FIGURE, "group: "], [...FIGURE.slice(0, 3), "query: se"], ["::box{list.divider="], ["::box{list.divider=\"d"], ["::box{li"]]) {
    test(`${JSON.stringify(lines.at(-1))} in ${lines.length > 1 ? "a figure" : "an attribute"}: the door and Detail list the same values`, async () => {
      const row = lines.length - 1, line = lines[row]!;
      const target = completionTargetAtCursor(line, line.length, lines, row)!;
      expect(target).not.toBeNull();
      const draft = { blockId: draftId, text: lines.join("\n") };
      const [door, mine] = await Promise.all([
        lookupCompletion(board, target, draft, { near: draftId }),
        lookupReferenceCompletion(detail(), target, draft),
      ]);
      expect(door.items.length).toBeGreaterThan(0);
      expect(mine.items.map(i => i.insertion)).toEqual(door.items.map(i => i.insertion));
    });
  }

  test("a filter's keys and values rank the same in the door and Detail", async () => {
    for (const target of [{ kind: "filter-key", query: "se" }, { kind: "filter-value", query: "", key: "season", words: true }] as const) {
      const door = await lookupCompletion(board, { ...target, start: 0, end: 0 });
      const answered = await lookupReferenceCompletion(detail(), { ...target, start: 0, end: 0 });
      expect(door.items.length).toBeGreaterThan(0);
      expect(answered.items.map(i => i.insertion)).toEqual(door.items.map(i => i.insertion));
    }
  });

  test("the rows are the outline's: its keys and values, its own callout type; the door draws what a row says to", async () => {
    const at = (line: string) => lookupCompletion(board, completionTargetAtCursor(line, line.length)!, undefined, {});
    expect((await at("[se")).items.map(i => i.insertion)).toContain("[season::");
    expect((await at("[crop::")).items.map(i => i.insertion)).toEqual(expect.arrayContaining(["beans]", "leeks]", "kale]"]));
    const recipe = (await at("> [!re")).items.find(i => i.insertion === "[!recipe]")!;
    expect(recipe.label).toContain("♨");
    expect(recipe.preview?.(40, 6).join("\n")).toContain("Recipe");
    // A component opens into its variations and arguments, and draws its source and properties table.
    const stat = (await at("::graph-stat")).items.find(i => i.id === "graph-stat")!;
    expect(stat.children?.some(c => c.kind === "property")).toBe(true);
    expect(stat.preview?.(60, 40).join("\n")).toContain("[copy] ::graph-stat");
  });

  test("[key lists every key the notes carry, however many values one has; [key:: the notes' values before a schema's", async () => {
    for (let i = 0; i < 120; i++) await create(`Tray ${i} [sown::day-${i}]`);
    await create("Spare bed [status::fallow]");
    await create("Back bed [status::fallow]");
    const at = (line: string) => lookupCompletion(board, completionTargetAtCursor(line, line.length)!, undefined, {});
    const keys = (await at("[s")).items.map(i => i.insertion);
    expect(keys).toEqual(expect.arrayContaining(["[sown::", "[season::", "[status::"]));
    expect((await at("[status::")).items[0]!.insertion).toBe("fallow]");
  });

  test("a component chosen in Detail writes all its lines, its first value selected", async () => {
    const buffer = new TextBuffer("Planting notes\n::graph-st");
    buffer.placeCursor(1, "::graph-st".length);
    const session = new ReferenceCompletionSession(detail(), () => buffer, () => {}, () => true, () => ({ blockId: draftId, text: buffer.text }));
    await session.refresh();
    const index = session.state!.items.findIndex(i => i.id === "graph-stat");
    expect(index).toBeGreaterThanOrEqual(0);
    const written = session.state!.items[index]!;
    expect(await session.accept(index)).toBe(true);
    expect(buffer.text).toBe(`Planting notes\n${written.insertion}`);
    expect(buffer.lines.length).toBe(1 + written.insertion.split("\n").length);
    const { start, end } = written.selection!;
    expect(buffer.selectedText).toBe(written.insertion.slice(start, end));
  });
});
