import { STRIKETHROUGH_DELIMITER } from "@ep0ch/outline-core/inline-grammar";
import { Tokenizer, type MarkedExtension } from "marked";
import { COMPONENT_OPEN, componentBlockAt } from "@ep0ch/outline-core/component-block";
import { parseStyleAttrs, resolveStyle } from "@ep0ch/outline-core/style-cascade";

/** A component boundary within the current paragraph; Marked asks again for every paragraph. */
export function componentLineIn(source: string, name?: string): number {
  for (let at = source.indexOf("\n"); at >= 0;) {
    const from = at + 1, next = source.indexOf("\n", from), line = source.slice(from, next < 0 ? source.length : next);
    if (!line.trim()) return -1;
    const open = COMPONENT_OPEN.exec(line);
    if (open && (name === undefined || open[1] === name) && componentBlockAt(source.slice(from))) return from;
    at = next;
  }
  return -1;
}

export const boxExtension: NonNullable<MarkedExtension["extensions"]>[number] = {
  name: "noteBox", level: "block",
  start: source => { const at = componentLineIn(source, "box"); return at < 0 ? undefined : at; },
  tokenizer(source) {
    const block = componentBlockAt(source);
    if (block?.name !== "box") return;
    const start = block.raw.indexOf("\n") + 1;
    const end = block.raw.trimEnd().lastIndexOf("\n");
    const attrs = COMPONENT_OPEN.exec(block.raw.slice(0, start - 1))?.[3]?.slice(1, -1) ?? "";
    return { type: "noteBox", raw: block.raw, attrs, bodyStart: start, bodyEnd: end, tokens: this.lexer.blockTokens(block.raw.slice(start, end)) };
  },
  renderer(token) {
    const v = resolveStyle([{ level: "block", label: "box", fields: { "margin.x": "0", ...parseStyleAttrs(token.attrs).fields } }], 80).values;
    const framed = v.border !== "auto" && v.border !== "none" || v.edge === "box";
    const style = `margin:${v["margin.y"]}em ${v["margin.x"]}ch;padding:${v["pad.y"]}em ${v["pad.x"]}ch;` +
      (framed ? `border:1px solid var(--rule);${v.border === "round" ? "border-radius:.5rem;" : ""}` : "") +
      (v.edge === "bar" ? "border-left:3px solid var(--link);" : "") +
      (v.bg !== "none" ? "background:color-mix(in srgb,var(--link) 8%,var(--bg));" : "");
    return `<section class="note-box" style="${style}">${this.parser.parse(token.tokens!)}</section>\n`;
  },
};

/** Keep Marked's inline parsing, but use Blockdown's strike delimiter. */
export const blockdownMarked: MarkedExtension = {
  extensions: [boxExtension],
  tokenizer: {
    lheading(source) {
      // Marked tries setext headings before the paragraph's extension boundary.
      const box = componentLineIn(source, "box");
      if (box < 0) return undefined;
      const heading = Tokenizer.prototype.lheading.call(this, source);
      if (!heading || heading.raw.length <= box) return undefined;
      const raw = source.slice(0, box), text = raw.trimEnd();
      return { type: "paragraph", raw, text, tokens: this.lexer.inline(text) } as unknown as false;
    },
    del(source) {
      return source.startsWith(STRIKETHROUGH_DELIMITER) ? false : undefined;
    },
  },
};
