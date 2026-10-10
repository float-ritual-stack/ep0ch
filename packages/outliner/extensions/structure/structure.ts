// Structure: extract a passage into a child block, sort a list in a block, sort a block's children. A userland
// extension: it reads the outline and writes through its own connection (outline.ts) as ext:structure, and imports
// nothing from the outline's code.
import { outline } from "./outline";
import { extractFrom, lineRange, sortListInText, sortSpec, compareKeys, propertyIn } from "./lists";

interface Block { id: string; parentId: string | null; position: number; text: string; revision: number; createdAt: string; properties: { key: string; value: string }[] }
const request = (await Bun.stdin.json()) as { operation: string; input: any };
const say = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));
const refuse = (message: string) => say({ message: `refused: ${message}` });

async function act() {
  const { action, args, target, context } = request.input as {
    action: string; args?: Record<string, string>;
    target?: { blockId?: string; revision?: number; text?: string; passage?: { start: number; end: number; quote: string } };
    context?: { block?: { properties?: { key: string; value: string }[] } };
  };
  const blockId = target?.blockId;
  if (!blockId) return refuse("this acts on a block (block=<id>)");
  const block = await outline<Block>({ action: "get", blockId });

  if (action === "extract" || action === "sort-selection") {
    const p = target!.passage!;
    if (block.revision !== target!.revision || block.text.slice(p.start, p.end) !== p.quote) return refuse("the note changed since you selected; select again");
    if (action === "extract") {
      const { child, replace } = extractFrom(block.text, p.start, p.end);
      if (!child.trim()) return refuse("nothing to extract");
      const made = await outline<Block>({ action: "create", parentId: block.id, text: child });
      // The note is rewritten by the returned write, not over the connection: the service checks the passage again
      // before it applies writes, and a rewrite made first would have taken the passage's words away.
      return say({ message: `extracted ${child.split("\n").length} line(s) into ((${made.id}))`, writes: [{ op: "update", blockId: block.id, expectedRevision: target!.revision, text: replace(made.id) }] });
    }
    try {
      const spec = sortSpec(args, block.properties);
      const [lo, hi] = lineRange(block.text, p.start, p.end);
      const sorted = sortListInText(block.text, spec, 0, [lo, hi]);
      return say({ message: `sorted ${sorted.count} items by ${spec.by} ${spec.order}`, writes: [{ op: "update", blockId: block.id, expectedRevision: block.revision, text: sorted.text }] });
    } catch (e) { return refuse((e as Error).message); }
  }

  if (action === "sort-list") {
    try {
      const spec = sortSpec(args, block.properties);
      const sorted = sortListInText(block.text, spec, Math.max(0, Number(args?.list ?? "1") - 1));
      return say({ message: `sorted ${sorted.count} items by ${spec.by} ${spec.order}`, writes: [{ op: "update", blockId: block.id, expectedRevision: block.revision, text: sorted.text }] });
    } catch (e) { return refuse((e as Error).message); }
  }

  if (action === "sort-blocks") {
    let spec;
    try { spec = sortSpec(args, block.properties); } catch (e) { return refuse((e as Error).message); }
    let kids = await outline<Block[]>({ action: "children", parentId: block.id });
    if (kids.length < 2) return say({ message: "nothing to sort: fewer than two children" });
    const keyOf = (b: Block) => spec.by === "title" ? b.text.split("\n")[0]!.replace(/\[[A-Za-z][\w.-]*::[^\]]*\]/g, "").trim()
      : spec.by === "created" ? b.createdAt : (b.properties.find((x) => x.key === spec.by)?.value ?? propertyIn(b.text.split("\n"), spec.by));
    if (!["title", "created"].includes(spec.by) && !kids.some((k) => keyOf(k) !== undefined)) {
      const keys = [...new Set(kids.flatMap((k) => k.properties.map((x) => x.key)))].sort();
      return refuse(`no child has ${spec.by}${keys.length ? `; they have ${keys.join(", ")}` : ""}`);
    }
    const want = kids.map((k, i) => ({ k, i })).sort((a, b) => compareKeys(keyOf(a.k), keyOf(b.k), spec.order) || a.i - b.i).map((x) => x.k.id);
    let moved = 0;
    for (let at = 0; at < want.length; at++) {
      if (kids[at]!.id === want[at]) continue;
      const one = await outline<Block>({ action: "get", blockId: want[at]! });
      await outline({ action: "move", blockId: one.id, parentId: block.id, position: at, expectedRevision: one.revision });
      kids = await outline<Block[]>({ action: "children", parentId: block.id });
      moved++;
    }
    return say({ message: `sorted ${want.length} children by ${spec.by} ${spec.order} (${moved} moved)` });
  }
  return refuse(`unknown action ${action}`);
}

if (request.operation === "act") await act();
else say({ message: `no ${request.operation}` });
