// Kind 3, rich component: `columns:: 3` on a block draws the notes under it as sections side by side. A row of
// boxes is the shared primitive every client that draws components lays out (the door sets them beside each other
// and stacks them when narrow). Sections are plain text here: the primitives have no Blockdown primitive, so a
// section's formatting is lost in the view (its words are not). `targets` carries the same sections as a grid
// (html) and in order (markdown, blockdown) for the clients that ask by target.

interface Child { id: string; text: string }
interface Request {
  operation: string;
  input: { argument?: string | null; context: { block: { text: string }; line?: { index: number }; children: Child[] } };
}

const MAX_COLUMNS = 4;
const request = (await Bun.stdin.json()) as Request;
const wanted = Number(request.input.argument ?? 0) || 0;

/** A section: its first line is its title, the rest its words. */
function section(child: Child): { title: string; lines: string[] } {
  const [first = "", ...rest] = child.text.split("\n");
  const title = first.replace(/\s*\[[\w.-]+::[^\]]*\]/g, "").replace(/^#+\s*/, "").trim();
  return { title, lines: rest };
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Sections written in the block itself, under the `columns::` line, split by a line of `|||`. Unlike the notes
 * under the line, these change the block's revision when edited, so the view redraws at once.
 */
function written(text: string, line: number): Child[] {
  const rest = text.split("\n").slice(line + 1).join("\n");
  return rest.split(/^\|\|\|\s*$/m).map((part, index) => ({ id: String(index), text: part.trim() })).filter((part) => part.text);
}

const { block, line, children } = request.input.context;
const inline = written(block.text, line?.index ?? 0);
const sections = (inline.length ? inline : children).filter((child) => child.text.trim()).map(section);
const count = Math.min(MAX_COLUMNS, wanted || sections.length || 1);
const shown = sections.slice(0, Math.max(count, 1));

const view = {
  type: "row",
  children: shown.map(({ title, lines }) => ({
    type: "box",
    title: title || undefined,
    children: [{ type: "text", text: lines.join("\n").trim() || " " }],
  })),
};

const markdown = shown.map(({ title, lines }) => `**${title}**\n\n${lines.join("\n").trim()}`).join("\n\n---\n\n");
const html = `<div class="ext-columns" style="display:grid;gap:1.25rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))">${
  shown.map(({ title, lines }) =>
    `<section class="ext-column"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(lines.join("\n").trim()).replace(/\n/g, "<br>")}</p></section>`).join("")
}</div>`;

process.stdout.write(JSON.stringify({
  ok: true,
  value: {
    title: `${shown.length} columns`,
    data: { columns: shown.map(({ title, lines }) => ({ title, text: lines.join("\n").trim() })), hidden: sections.length - shown.length },
    view: shown.length ? view : { type: "text", text: "columns: no notes under this line yet", tone: "dim" },
    targets: { html, markdown },
  },
}));
