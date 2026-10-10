// Kind 3, rich component: `columns:: 3` on a block draws the notes under it as sections side by side. A row of
// boxes is the shared primitive every client lays out: the door and Detail beside each other, the web as a grid, each
// stacking them when a column would be narrower than the row's `minWidth`. A section's words are a `blockdown`
// primitive, so each reader draws them as it draws a note (headings, lists, links, properties). No `targets`: the
// service composes Markdown (the sections in order) and HTML from the same view.

interface Child { id: string; text: string }
interface Request {
  operation: string;
  input: { argument?: string | null; context: { block: { text: string }; line?: { index: number }; children: Child[] } };
}

const MAX_COLUMNS = 4;
/** A column narrower than this many characters reads badly: the row stacks instead. */
const MIN_COLUMN = 24;
const request = (await Bun.stdin.json()) as Request;
const wanted = Number(request.input.argument ?? 0) || 0;

/** A section: its first line is its title, the rest its words. */
function section(child: Child): { title: string; lines: string[] } {
  const [first = "", ...rest] = child.text.split("\n");
  const title = first.replace(/\s*\[[\w.-]+::[^\]]*\]/g, "").replace(/^#+\s*/, "").trim();
  return { title, lines: rest };
}

/**
 * Sections written in the block itself, under the `columns::` line, split by a line of `|||`. Unlike the notes
 * under the line, these change the block's revision when edited, so the view redraws at once.
 */
function written(text: string, line: number): Child[] {
  const rest = text.split("\n").slice(line + 1).join("\n");
  // Only a block that uses the marker is written inline; any other words under the line leave the child notes alone.
  if (!/^\|\|\|\s*$/m.test(rest)) return [];
  return rest.split(/^\|\|\|\s*$/m).map((part, index) => ({ id: String(index), text: part.trim() })).filter((part) => part.text);
}

const { block, line, children } = request.input.context;
const inline = written(block.text, line?.index ?? 0);
const sections = (inline.length ? inline : children).filter((child) => child.text.trim()).map(section);
const count = Math.min(MAX_COLUMNS, wanted || sections.length || 1);
const shown = sections.slice(0, Math.max(count, 1));

const view = {
  type: "row",
  minWidth: MIN_COLUMN,
  children: shown.map(({ title, lines }) => ({
    type: "box",
    title: title || undefined,
    children: [{ type: "blockdown", text: lines.join("\n").trim() || " " }],
  })),
};

process.stdout.write(JSON.stringify({
  ok: true,
  value: {
    title: `${shown.length} columns`,
    data: { columns: shown.map(({ title, lines }) => ({ title, text: lines.join("\n").trim() })), hidden: sections.length - shown.length },
    view: shown.length ? view : { type: "text", text: "columns: no notes under this line yet", tone: "dim" },
  },
}));
